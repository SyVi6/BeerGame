const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.3";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];

const ROLE_PARAMS = {
    retailer:    { lead: 2, baseSafety: 3, lambda: 0.45, maxStepUp: 45, maxStepDown: 55, max: 220 },
    wholesaler:  { lead: 2, baseSafety: 3, lambda: 0.40, maxStepUp: 35, maxStepDown: 50, max: 180 },
    distributor: { lead: 2, baseSafety: 2, lambda: 0.35, maxStepUp: 30, maxStepDown: 45, max: 160 },
    factory:     { lead: 2, baseSafety: 2, lambda: 0.30, maxStepUp: 25, maxStepDown: 40, max: 140 }
};

function asInt(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return Math.round(v);
    if (typeof v === "string") {
        const n = parseInt(v.trim(), 10);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function ewma(values, lambda) {
    if (!values || values.length === 0) return 0;
    let s = values[0];
    for (let i = 1; i < values.length; i++) {
        s = lambda * values[i] + (1 - lambda) * s;
    }
    return Math.max(0, s);
}

function getRoleState(weekObj, role) {
    const roles = weekObj?.roles || {};
    const r = roles[role] || {};
    return {
        inventory: Math.max(0, asInt(r.inventory)),
        backlog: Math.max(0, asInt(r.backlog)),
        incoming_orders: Math.max(0, asInt(r.incoming_orders)),
        arriving_shipments: Math.max(0, asInt(r.arriving_shipments))
    };
}

function getPrevOrder(weekObj, role) {
    const orders = weekObj?.orders || {};
    return Math.max(0, asInt(orders[role]));
}

function estimateOnOrderWindowed(weeks, role, window) {
    const start = Math.max(0, weeks.length - window);
    let onOrder = 0;
    for (let i = start; i < weeks.length; i++) {
        const w = weeks[i];
        const rs = getRoleState(w, role);
        const o = getPrevOrder(w, role);
        onOrder += (o - rs.arriving_shipments);
    }
    return onOrder;
}

function backlogTrend(weeks, role) {
    if (!weeks || weeks.length < 2) return 0;
    const a = getRoleState(weeks[weeks.length - 2], role).backlog;
    const b = getRoleState(weeks[weeks.length - 1], role).backlog;
    return b - a;
}

function decideForRole(role, weeks) {
    const p = ROLE_PARAMS[role] || ROLE_PARAMS.retailer;
    if (!weeks || weeks.length === 0) return 10;

    const incomingHist = [];
    const prevOrders = [];

    for (const w of weeks) {
        const rs = getRoleState(w, role);
        incomingHist.push(rs.incoming_orders);
        prevOrders.push(getPrevOrder(w, role));
    }

    const lastWeek = weeks[weeks.length - 1];
    const last = getRoleState(lastWeek, role);
    const lastOrder = prevOrders[prevOrders.length - 1] || 0;

    // Forecast demand (EWMA)
    const forecast = ewma(incomingHist, p.lambda);

    // Better pipeline estimate: windowed
    const window = p.lead + 2; // small, stable window
    const onOrder = estimateOnOrderWindowed(weeks, role, window);

    // Inventory position (CAN be negative)
    const invPos = (last.inventory - last.backlog) + onOrder;

    // Adaptive safety: if backlog exists or is rising, increase safety temporarily.
    // Keeps inventory low when things are fine, but fights persistent backlog.
    const bTrend = backlogTrend(weeks, role);
    const safetyBoost =
        Math.ceil(last.backlog / 25) +            // +1 per ~25 backlog
        (bTrend > 0 ? 1 : 0);                     // +1 if backlog is increasing

    const safety = p.baseSafety + clamp(safetyBoost, 0, 6);

    // Target base-stock
    const target = Math.round(forecast * (p.lead + 1) + safety);

    // Core order-up-to
    let desired = Math.round(target - invPos);
    if (desired < 0) desired = 0;

    // If backlog is high, allow faster ramp-up to catch up.
    // If backlog is zero, keep it smooth to avoid bullwhip.
    const extraUp = clamp(Math.ceil(last.backlog / 15), 0, 30); // up to +30 extra step
    const stepUp = p.maxStepUp + extraUp;
    const stepDown = p.maxStepDown;

    let order = clamp(desired, lastOrder - stepDown, lastOrder + stepUp);

    // Cap avoidance
    order = Math.min(order, p.max);

    return order;
}

module.exports = async (req, res) => {
    // Health check / compatibility
    if (req.method === "GET") {
        res.status(200).json({ ok: true, message: "BeerBot online. Use POST /api/decision" });
        return;
    }

    if (req.method !== "POST") {
        res.status(405).json({ ok: false, message: "Method Not Allowed" });
        return;
    }

    const body = req.body || {};

    // Handshake
    if (body.handshake === true) {
        res.status(200).json({
            ok: true,
            student_email: STUDENT_EMAIL,
            algorithm_name: ALGO_NAME,
            version: VERSION,
            supports: { blackbox: true, glassbox: true },
            message: "BeerBot ready",
            uses_llm: false,
            llm_description: "deterministic heuristics",
            student_comment: "EWMA forecast + base-stock with adaptive safety + windowed pipeline + adaptive ramp-up"
        });
        return;
    }

    // Weekly decision
    const weeks = Array.isArray(body.weeks) ? body.weeks : [];
    const orders = {};
    for (const role of ROLES) {
        orders[role] = decideForRole(role, weeks);
    }

    res.status(200).json({ orders });
};
