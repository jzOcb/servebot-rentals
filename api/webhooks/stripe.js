// POST /api/webhooks/stripe
// Handles Stripe webhook events

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Disable body parsing, need raw body for webhook verification
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

    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            rawBody,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const bookingId = session.metadata?.booking_id;

            if (bookingId) {
                // Update booking status to confirmed
                const { error } = await supabase
                    .from('bookings')
                    .update({
                        status: 'confirmed',
                        stripe_payment_intent: session.payment_intent
                    })
                    .eq('id', bookingId);

                if (error) {
                    console.error('Failed to update booking:', error);
                } else {
                    console.log(`Booking ${bookingId} confirmed`);
                    
                    // TODO: Send confirmation email
                    // await sendConfirmationEmail(bookingId);
                    
                    // TODO: Send notification to owner
                    // await notifyOwner(bookingId);
                }
            }
            break;
        }

        case 'checkout.session.expired': {
            const session = event.data.object;
            const bookingId = session.metadata?.booking_id;

            if (bookingId) {
                // Cancel the pending booking
                await supabase
                    .from('bookings')
                    .update({ status: 'cancelled' })
                    .eq('id', bookingId)
                    .eq('status', 'pending');

                console.log(`Booking ${bookingId} cancelled (session expired)`);
            }
            break;
        }

        case 'charge.refunded': {
            const charge = event.data.object;
            // Handle deposit refund if needed
            console.log('Charge refunded:', charge.id);
            break;
        }

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
}
