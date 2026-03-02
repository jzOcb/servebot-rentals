// POST /api/webhooks/stripe
// Handles Stripe webhook events

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
            const bookingId = session.metadata?.booking_id || null;

            if (!bookingId) {
                console.error('Missing booking_id in checkout session metadata:', session.id);
                break;
            }

            const { data: booking, error } = await supabase
                .from('bookings')
                .update({
                    status: 'confirmed',
                    stripe_session_id: session.id,
                    stripe_payment_intent: session.payment_intent
                })
                .eq('id', bookingId)
                .in('status', ['pending', 'confirmed'])
                .select('id')
                .single();

            if (error) {
                console.error('Failed to confirm booking from webhook:', error);
            } else {
                console.log(`Booking ${booking.id} confirmed from webhook`);
            }
            break;
        }

        case 'checkout.session.expired': {
            const session = event.data.object;
            const bookingId = session.metadata?.booking_id || null;

            if (!bookingId) {
                break;
            }

            const { error } = await supabase
                .from('bookings')
                .update({ status: 'cancelled' })
                .eq('id', bookingId)
                .eq('status', 'pending');

            if (error) {
                console.error('Failed to cancel expired pending booking:', error);
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
