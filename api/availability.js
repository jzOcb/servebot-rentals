// GET /api/availability
// Returns available dates for booking

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Pricing configuration
const PRICING = {
    half_day_weekday: { price: 4500, days: 1, dayType: 'weekday' },
    full_day_weekday: { price: 7500, days: 1, dayType: 'weekday' },
    half_day_weekend: { price: 5500, days: 1, dayType: 'weekend' },
    full_day_weekend: { price: 10000, days: 1, dayType: 'weekend' },
    weekend_package: { price: 12500, days: 2, dayType: 'weekend' },
    weekly: { price: 25000, days: 7, dayType: 'any' },
    first_time: { price: 5000, days: 1, dayType: 'any' }
};

const ALLOWED_ORIGINS = ['https://servebot-rentals.vercel.app', 'https://servebotrentals.com', 'https://www.servebotrentals.com'];

function dateToStr(dateObj) {
    return dateObj.toISOString().slice(0, 10);
}

function getAvailableMachineCount(dateStr, activeMachines, bookings, blockedDates) {
    let allBlocked = false;
    const blockedMachineIds = new Set();

    for (const blocked of blockedDates || []) {
        if (blocked.date !== dateStr) {
            continue;
        }

        if (blocked.machine_id === null) {
            allBlocked = true;
            break;
        }

        blockedMachineIds.add(blocked.machine_id);
    }

    if (allBlocked) {
        return 0;
    }

    const bookedMachineIds = new Set();
    const currentDate = new Date(`${dateStr}T12:00:00Z`);

    for (const booking of bookings || []) {
        const bookingStart = new Date(`${booking.start_date}T12:00:00Z`);
        const bookingEnd = new Date(`${booking.end_date}T12:00:00Z`);

        if (currentDate >= bookingStart && currentDate <= bookingEnd && booking.machine_id) {
            bookedMachineIds.add(booking.machine_id);
        }
    }

    let available = 0;
    for (const machineId of activeMachines) {
        if (!bookedMachineIds.has(machineId) && !blockedMachineIds.has(machineId)) {
            available += 1;
        }
    }

    return available;
}

function hasConsecutiveAvailability(startDate, days, activeMachines, bookings, blockedDates) {
    const current = new Date(startDate);

    for (let i = 0; i < days; i++) {
        const dateStr = dateToStr(current);
        const available = getAvailableMachineCount(dateStr, activeMachines, bookings, blockedDates);
        if (available <= 0) {
            return false;
        }
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return true;
}

export default async function handler(req, res) {
    const origin = req.headers.origin; res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { start, end, type } = req.query;

        const startDate = start || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const endDate = end || (() => {
            const d = new Date();
            d.setDate(d.getDate() + 90);
            return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        })();
        const rentalType = type || 'full_day_weekday';

        const config = PRICING[rentalType];
        if (!config) {
            return res.status(400).json({ error: 'Invalid rental type' });
        }

        const { data: machines, error: machinesError } = await supabase
            .from('machines')
            .select('id')
            .eq('status', 'active');

        if (machinesError) {
            console.error('Machines error:', machinesError);
            return res.status(500).json({ error: 'Database error' });
        }

        const activeMachines = (machines || []).map((machine) => machine.id);
        if (activeMachines.length === 0) {
            return res.status(200).json({
                rental_type: rentalType,
                price: config.price,
                days: config.days,
                available_dates: [],
                machines_by_date: {}
            });
        }

        const pendingCutoffIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        const { data: bookings, error: bookingsError } = await supabase
            .rpc('get_booking_ranges_for_availability', {
                p_start_date: startDate,
                p_end_date: endDate,
                p_pending_cutoff: pendingCutoffIso
            });

        if (bookingsError) {
            console.error('Bookings error:', bookingsError);
            return res.status(500).json({ error: 'Database error' });
        }

        const { data: blockedDates, error: blockedError } = await supabase
            .from('blocked_dates')
            .select('date, machine_id')
            .gte('date', startDate)
            .lte('date', endDate);

        if (blockedError) {
            console.error('Blocked dates error:', blockedError);
            return res.status(500).json({ error: 'Database error' });
        }

        const availability = {};
        const current = new Date(`${startDate}T00:00:00Z`);
        const endDateObj = new Date(`${endDate}T00:00:00Z`);

        while (current <= endDateObj) {
            const dateStr = dateToStr(current);
            const dayOfWeek = current.getUTCDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isWeekday = !isWeekend;

            let validDayType = false;
            if (config.dayType === 'any') {
                validDayType = true;
            } else if (config.dayType === 'weekend' && isWeekend) {
                validDayType = true;
            } else if (config.dayType === 'weekday' && isWeekday) {
                validDayType = true;
            }

            if (rentalType === 'weekend_package' && dayOfWeek !== 6) {
                validDayType = false;
            }

            if (validDayType) {
                const availableMachines = getAvailableMachineCount(dateStr, activeMachines, bookings || [], blockedDates || []);
                let isAvailable = availableMachines > 0;

                if (rentalType === 'weekly' && isAvailable) {
                    isAvailable = hasConsecutiveAvailability(current, 7, activeMachines, bookings || [], blockedDates || []);
                }

                if (rentalType === 'weekend_package' && isAvailable) {
                    isAvailable = hasConsecutiveAvailability(current, 2, activeMachines, bookings || [], blockedDates || []);
                }

                if (isAvailable) {
                    availability[dateStr] = availableMachines;
                }
            }

            current.setUTCDate(current.getUTCDate() + 1);
        }

        return res.status(200).json({
            rental_type: rentalType,
            price: config.price,
            days: config.days,
            available_dates: Object.keys(availability),
            machines_by_date: availability
        });
    } catch (error) {
        console.error('Availability error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
