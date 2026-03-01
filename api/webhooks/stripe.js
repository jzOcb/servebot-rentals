// POST /api/webhooks/stripe
// Handles Stripe webhook events
// Payment-first: creates booking in DB only after successful payment

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
    api: {
        bodyParser: false
    }
};

async function getRawBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.error('STRIPE_WEBHOOK_SECRET is not configured.');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];

    if (!sig) {
        return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const meta = session.metadata || {};

            // Payment-first: create booking from metadata
            if (meta.customer_name && meta.start_date) {
                const { data: booking, error } = await supabase
                    .from('bookings')
                    .insert({
                        customer_name: meta.customer_name,
                        customer_email: meta.customer_email,
                        customer_phone: meta.customer_phone,
                        rental_type: meta.rental_type,
                        start_date: meta.start_date,
                        end_date: meta.end_date,
                        pickup_delivery: meta.pickup_delivery,
                        delivery_address: meta.delivery_address || null,
                        total_amount: parseInt(meta.total_amount, 10),
                        deposit_amount: parseInt(meta.deposit_amount, 10),
                        status: 'confirmed',
                        stripe_session_id: session.id,
                        stripe_payment_intent: session.payment_intent,
                        notes: meta.notes || null
                    })
                    .select()
                    .single();

                if (error) {
                    console.error('Failed to create booking from webhook:', error);
                } else {
                    console.log(`Booking ${booking.id} created and confirmed`);
                }
            }
            break;
        }

        case 'charge.refunded': {
            const charge = event.data.object;
            console.log('Charge refunded:', charge.id);
            break;
        }

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
}
