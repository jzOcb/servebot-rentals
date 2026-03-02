// GET /api/cron/cancel-stale-pending
// Vercel Cron endpoint: cancel pending bookings older than 30 minutes.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Missing Supabase service role configuration' });
    }

    try {
        const staleCutoffIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        const { data: cancelledBookings, error } = await supabase
            .from('bookings')
            .update({ status: 'cancelled' })
            .eq('status', 'pending')
            .lt('created_at', staleCutoffIso)
            .select('id');

        if (error) {
            console.error('Cron cancel stale pending bookings error:', error);
            return res.status(500).json({ error: 'Database error' });
        }

        return res.status(200).json({
            ok: true,
            cancelled_count: (cancelledBookings || []).length,
            stale_cutoff: staleCutoffIso
        });
    } catch (err) {
        console.error('Cron cancel stale pending bookings unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
