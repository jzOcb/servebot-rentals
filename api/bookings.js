// POST /api/bookings
// Validates booking input, rate-limits requests, reserves a machine atomically,
// and creates a Stripe checkout session.

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Pricing configuration (in cents)
const PRICING = {
    half_day_weekday: { price: 4500, days: 1, name: 'Half Day Rental (Weekday)' },
    full_day_weekday: { price: 7500, days: 1, name: 'Full Day Rental (Weekday)' },
    half_day_weekend: { price: 5500, days: 1, name: 'Half Day Rental (Weekend)' },
    full_day_weekend: { price: 10000, days: 1, name: 'Full Day Rental (Weekend)' },
    weekend_package: { price: 12500, days: 2, name: 'Weekend Package (Sat+Sun)' },
    weekly: { price: 25000, days: 7, name: 'Weekly Rental' },
    first_time: { price: 5000, days: 1, name: 'First Time Experience (Full Day)' }
};

const DEPOSIT_AMOUNT = 30000; // $300 in cents
const DELIVERY_FEE = 2500; // $25 in cents
const ALLOWED_ORIGINS = ['https://servebot-rentals.vercel.app', 'https://servebotrentals.com', 'https://www.servebotrentals.com'];

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitByIp = new Map();
let lastRateLimitCleanup = 0;

function getTodayET() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function addDays(dateStr, daysToAdd) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(year, month - 1, day));
    dt.setUTCDate(dt.getUTCDate() + daysToAdd);
    return dt.toISOString().slice(0, 10);
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

function cleanupRateLimit(now) {
    if (now - lastRateLimitCleanup < 10 * 60 * 1000) {
        return;
    }

    for (const [ip, entry] of rateLimitByIp.entries()) {
        if (entry.expiresAt <= now) {
            rateLimitByIp.delete(ip);
        }
    }

    lastRateLimitCleanup = now;
}

function isRateLimited(ip, now) {
    cleanupRateLimit(now);

    const existing = rateLimitByIp.get(ip);
    if (!existing || existing.expiresAt <= now) {
        rateLimitByIp.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }

    if (existing.count >= RATE_LIMIT_MAX) {
        return true;
    }

    existing.count += 1;
    return false;
}

function normalizeRequiredString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req, res) {
    const origin = req.headers.origin; res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const clientIp = getClientIp(req);
        const now = Date.now();

        if (isRateLimited(clientIp, now)) {
            return res.status(429).json({ error: 'Too many booking attempts. Please try again later.' });
        }

        const customer_name = normalizeRequiredString(req.body.customer_name);
        const customer_email = normalizeRequiredString(req.body.customer_email).toLowerCase();
        const customer_phone = normalizeRequiredString(req.body.customer_phone);
        const rental_type = normalizeRequiredString(req.body.rental_type);
        const start_date = normalizeRequiredString(req.body.start_date);
        const pickup_delivery = normalizeRequiredString(req.body.pickup_delivery);
        const delivery_address = typeof req.body.delivery_address === 'string' ? req.body.delivery_address.trim() : '';
        const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

        if (!customer_name || !customer_email || !customer_phone || !rental_type || !start_date || !pickup_delivery) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (customer_name.length > 100) {
            return res.status(400).json({ error: 'Name must be 100 characters or less' });
        }

        if (customer_email.length > 254) {
            return res.status(400).json({ error: 'Email must be 254 characters or less' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer_email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (customer_phone.length > 20) {
            return res.status(400).json({ error: 'Phone must be 20 characters or less' });
        }

        const phoneRegex = /^\+?[0-9().\-\s]{10,20}$/;
        const phoneDigits = customer_phone.replace(/\D/g, '');
        if (!phoneRegex.test(customer_phone) || phoneDigits.length < 10 || phoneDigits.length > 15) {
            return res.status(400).json({ error: 'Invalid phone format' });
        }

        if (!['pickup', 'delivery'].includes(pickup_delivery)) {
            return res.status(400).json({ error: 'Invalid pickup/delivery option' });
        }

        if (delivery_address.length > 200) {
            return res.status(400).json({ error: 'Delivery address must be 200 characters or less' });
        }

        if (notes.length > 500) {
            return res.status(400).json({ error: 'Notes must be 500 characters or less' });
        }

        if (pickup_delivery === 'delivery' && !delivery_address) {
            return res.status(400).json({ error: 'Delivery address required for delivery' });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        const today = getTodayET();
        if (start_date < today) {
            return res.status(400).json({ error: 'Start date cannot be in the past' });
        }

        const config = PRICING[rental_type];
        if (!config) {
            return res.status(400).json({ error: 'Invalid rental type' });
        }

        const end_date = addDays(start_date, config.days - 1);

        let totalAmount = config.price + DEPOSIT_AMOUNT;
        if (pickup_delivery === 'delivery') {
            totalAmount += DELIVERY_FEE;
        }

        const bookingId = randomUUID();
        const baseUrl = process.env.BASE_URL || CORS_ORIGIN;
        const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;

        const lineItems = [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: config.name,
                        description: `${start_date} to ${end_date}`
                    },
                    unit_amount: config.price
                },
                quantity: 1
            },
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Security Deposit',
                        description: 'Refundable upon return of equipment in good condition'
                    },
                    unit_amount: DEPOSIT_AMOUNT
                },
                quantity: 1
            }
        ];

        if (pickup_delivery === 'delivery') {
            lineItems.push({
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Delivery Fee',
                        description: 'Delivery within 15 miles'
                    },
                    unit_amount: DELIVERY_FEE
                },
                quantity: 1
            });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${baseUrl}/confirmation.html?booking_id=${encodeURIComponent(bookingId)}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/book.html?cancelled=true`,
            customer_email,
            expires_at: expiresAt,
            metadata: {
                booking_id: bookingId
            }
        });

        const { data: reservedBooking, error: reserveError } = await supabase
            .rpc('create_pending_booking_atomic', {
                p_booking_id: bookingId,
                p_customer_name: customer_name,
                p_customer_email: customer_email,
                p_customer_phone: phoneDigits,
                p_rental_type: rental_type,
                p_start_date: start_date,
                p_end_date: end_date,
                p_pickup_delivery: pickup_delivery,
                p_delivery_address: delivery_address || null,
                p_total_amount: totalAmount,
                p_deposit_amount: DEPOSIT_AMOUNT,
                p_notes: notes || null,
                p_stripe_session_id: session.id
            });

        if (reserveError) {
            try {
                await stripe.checkout.sessions.expire(session.id);
            } catch (expireErr) {
                console.error('Failed to expire checkout session after reservation failure:', expireErr);
            }

            if (reserveError.message && reserveError.message.includes('no_available_machine')) {
                return res.status(409).json({ error: 'No machines available for selected dates' });
            }

            console.error('Atomic booking reservation error:', reserveError);
            return res.status(500).json({ error: 'Could not reserve booking slot' });
        }

        return res.status(200).json({
            booking_id: reservedBooking?.[0]?.booking_id || bookingId,
            checkout_url: session.url
        });
    } catch (error) {
        console.error('Booking error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
