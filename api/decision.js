const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.4";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];
const ROLE_PARAMS = {
    retailer:    { lead: 2, safety: 2, lambda: 0.50, stepUp: 35, stepDown: 70, max: 200, bGain: 0.18 },
    wholesaler:  { lead: 2, safety: 2, lambda: 0.45, stepUp: 28, stepDown: 60, max: 170, bGain: 0.14 },
    distributor: { lead: 2, safety: 1, lambda: 0.40, stepUp: 22, stepDown: 55, max: 150, bGain: 0.10 },
    factory:     { lead: 2, safety: 1, lambda: 0.35, stepUp: 18, stepDown: 50, max: 130, bGain: 0.08 }
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

    // Demand forecast
    const forecast = ewma(incomingHist, p.lambda);

    // Pipeline
    const onOrder = estimateOnOrderWindowed(weeks, role, p.lead + 2);

    // Inventory position (can be negative)
    const invPos = (last.inventory - last.backlog) + onOrder;

    // Base-stock target
    const target = Math.round(forecast * (p.lead + 1) + p.safety);

    // Base order-up-to
    let desired = Math.round(target - invPos);
    if (desired < 0) desired = 0;

    // Small backlog correction (controlled): if backlog is big, add a fraction of it, but not too much..
    const backlogKick = Math.round(clamp(last.backlog, 0, 200) * p.bGain);
    desired = desired + backlogKick;

    const excess = invPos - target;
    const excessThreshold = Math.max(10, Math.round(forecast)); // ~1 week demand
    if (excess > excessThreshold) {
        desired = 0;
    }

    let order = clamp(desired, lastOrder - p.stepDown, lastOrder + p.stepUp);

    order = Math.max(0, Math.min(order, p.max));
    return order;
}

module.exports = async (req, res) => {
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
            student_comment: "EWMA + base-stock + small backlog kick + anti-hoarding + asymmetric rate limits"
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
