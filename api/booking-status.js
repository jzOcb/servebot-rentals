// GET /api/booking-status?booking_id=xxx|session_id=xxx
// Verifies booking status from a restricted RPC.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const ALLOWED_ORIGINS = ['https://servebot-rentals.vercel.app', 'https://servebotrentals.com', 'https://www.servebotrentals.com'];

export default async function handler(req, res) {
    const origin = req.headers.origin; res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const bookingId = req.query.booking_id || null;
    const sessionId = req.query.session_id || null;

    if (!bookingId && !sessionId) {
        return res.status(400).json({ error: 'Missing booking_id or session_id' });
    }

    try {
        const { data, error } = await supabase
            .rpc('get_public_booking_status', {
                p_booking_id: bookingId,
                p_session_id: sessionId
            });

        if (error) {
            console.error('Booking status query error:', error);
            return res.status(500).json({ error: 'Database error' });
        }

        const booking = Array.isArray(data) && data.length > 0 ? data[0] : null;

        if (!booking) {
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
