// POST /api/bookings
// Creates a new booking and returns Stripe checkout URL

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY // Service key for insert
);

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

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
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
        const startDateObj = new Date(start_date);
        const endDateObj = new Date(startDateObj);
        endDateObj.setDate(endDateObj.getDate() + config.days - 1);
        const end_date = endDateObj.toISOString().split('T')[0];

        // Check availability
        const { data: existingBookings, error: checkError } = await supabase
            .from('bookings')
            .select('id')
            .in('status', ['pending', 'confirmed', 'in_progress'])
            .lte('start_date', end_date)
            .gte('end_date', start_date);

        if (checkError) {
            console.error('Check availability error:', checkError);
            return res.status(500).json({ error: 'Database error' });
        }

        if (existingBookings && existingBookings.length >= 3) {
            return res.status(409).json({ error: 'No machines available for selected dates' });
        }

        // Calculate total
        let totalAmount = config.price + DEPOSIT_AMOUNT;
        if (pickup_delivery === 'delivery') {
            totalAmount += DELIVERY_FEE;
        }

        // Create booking record
        const { data: booking, error: insertError } = await supabase
            .from('bookings')
            .insert({
                customer_name,
                customer_email,
                customer_phone,
                rental_type,
                start_date,
                end_date,
                pickup_delivery,
                delivery_address: delivery_address || null,
                total_amount: totalAmount,
                deposit_amount: DEPOSIT_AMOUNT,
                status: 'pending',
                notes: notes || null
            })
            .select()
            .single();

        if (insertError) {
            console.error('Insert error:', insertError);
            return res.status(500).json({ error: 'Failed to create booking' });
        }

        // Create Stripe Checkout session
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

        const baseUrl = process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : 'http://localhost:3000';

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${baseUrl}/confirmation.html?booking_id=${booking.id}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/book.html?cancelled=true`,
            customer_email: customer_email,
            metadata: {
                booking_id: booking.id
            }
        });

        // Update booking with Stripe session ID
        await supabase
            .from('bookings')
            .update({ stripe_session_id: session.id })
            .eq('id', booking.id);

        return res.status(200).json({
            booking_id: booking.id,
            checkout_url: session.url
        });

    } catch (error) {
        console.error('Booking error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
