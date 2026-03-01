// GET /api/booking-status?session_id=xxx
// Verifies booking status by Stripe session ID

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
    const allowedOrigins = [
        'https://servebot-rentals.vercel.app',
        'https://servebotrentals.com',
        'http://localhost:3000'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { session_id } = req.query;
    if (!session_id) {
        return res.status(400).json({ error: 'Missing session_id' });
    }

    try {
        const { data: booking, error } = await supabase
            .from('bookings')
            .select('id, status, rental_type, start_date, end_date, pickup_delivery')
            .eq('stripe_session_id', session_id)
            .single();

        if (error || !booking) {
            return res.status(200).json({ status: 'pending' });
        }

        return res.status(200).json({
            status: booking.status,
            booking_id: booking.id,
            rental_type: booking.rental_type,
            start_date: booking.start_date,
            end_date: booking.end_date,
            pickup_delivery: booking.pickup_delivery
        });
    } catch (err) {
        console.error('Booking status error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
