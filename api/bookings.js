// POST /api/bookings
// Validates booking input and creates Stripe checkout session
// No database insert here — booking is created in webhook after payment

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing configuration (in cents)
const PRICING = {
    half_day_weekday: { price: 4500, days: 1, name: 'Half Day Rental (Weekday)' },
    full_day_weekday: { price: 7500, days: 1, name: 'Full Day Rental (Weekday)' },
    half_day_weekend: { price: 5500, days: 1, name: 'Half Day Rental (Weekend)' },
    full_day_weekend: { price: 10000, days: 1, name: 'Full Day Rental (Weekend)' },
    weekend_package: { price: 17500, days: 2, name: 'Weekend Package (Sat+Sun)' },
    weekly: { price: 35000, days: 7, name: 'Weekly Rental' }
};

const DEPOSIT_AMOUNT = 30000; // $300 in cents
const DELIVERY_FEE = 2500; // $25 in cents

// Get today's date in Eastern time as YYYY-MM-DD
function getTodayET() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default async function handler(req, res) {
    // CORS headers
    const allowedOrigins = [
        'https://servebot-rentals.vercel.app',
        'https://servebotrentals.com',
        'http://localhost:3000'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            customer_name,
            customer_email,
            customer_phone,
            rental_type,
            start_date,
            pickup_delivery,
            delivery_address,
            notes
        } = req.body;

        // Validate required fields
        if (!customer_name || !customer_email || !customer_phone || 
            !rental_type || !start_date || !pickup_delivery) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Name: max 100 chars
        if (typeof customer_name !== 'string' || customer_name.length > 100) {
            return res.status(400).json({ error: 'Name must be 100 characters or less' });
        }

        // Email regex validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer_email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Phone: digits only, 10-15 chars
        const phoneDigits = customer_phone.replace(/\D/g, '');
        if (phoneDigits.length < 10 || phoneDigits.length > 15) {
            return res.status(400).json({ error: 'Phone must be 10-15 digits' });
        }

        // Notes: max 500 chars
        if (notes && (typeof notes !== 'string' || notes.length > 500)) {
            return res.status(400).json({ error: 'Notes must be 500 characters or less' });
        }

        // Validate pickup_delivery value
        if (!['pickup', 'delivery'].includes(pickup_delivery)) {
            return res.status(400).json({ error: 'Invalid pickup/delivery option' });
        }

        // Validate start_date format and not in the past (Eastern time)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        const today = getTodayET();
        if (start_date < today) {
            return res.status(400).json({ error: 'Start date cannot be in the past' });
        }

        // Validate rental type
        const config = PRICING[rental_type];
        if (!config) {
            return res.status(400).json({ error: 'Invalid rental type' });
        }

        // Validate delivery address if delivery selected
        if (pickup_delivery === 'delivery' && !delivery_address) {
            return res.status(400).json({ error: 'Delivery address required for delivery' });
        }

        // Calculate end date based on rental type
        const startDateObj = new Date(start_date + 'T12:00:00');
        const endDateObj = new Date(startDateObj);
        endDateObj.setDate(endDateObj.getDate() + config.days - 1);
        const end_date = endDateObj.toISOString().split('T')[0];

        // Calculate total
        let totalAmount = config.price + DEPOSIT_AMOUNT;
        if (pickup_delivery === 'delivery') {
            totalAmount += DELIVERY_FEE;
        }

        // Build line items for Stripe
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

        const baseUrl = process.env.BASE_URL || 'https://servebot-rentals.vercel.app';

        // Stripe checkout expires in 30 minutes
        const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${baseUrl}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/book.html?cancelled=true`,
            customer_email: customer_email,
            expires_at: expiresAt,
            metadata: {
                customer_name,
                customer_email,
                customer_phone: phoneDigits,
                rental_type,
                start_date,
                end_date,
                pickup_delivery,
                delivery_address: delivery_address || '',
                total_amount: String(totalAmount),
                deposit_amount: String(DEPOSIT_AMOUNT),
                notes: notes || ''
            }
        });

        return res.status(200).json({
            checkout_url: session.url
        });

    } catch (error) {
        console.error('Booking error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
