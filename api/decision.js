const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.2";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];

// lead = assumed effective lead time (weeks) in the game
const ROLE_PARAMS = {
    retailer:    { lead: 2, safety: 2, lambda: 0.45, maxStepUp: 40, maxStepDown: 60, max: 200 },
    wholesaler:  { lead: 2, safety: 2, lambda: 0.40, maxStepUp: 30, maxStepDown: 50, max: 160 },
    distributor: { lead: 2, safety: 1, lambda: 0.35, maxStepUp: 25, maxStepDown: 45, max: 140 },
    factory:     { lead: 2, safety: 1, lambda: 0.30, maxStepUp: 20, maxStepDown: 40, max: 120 }
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

function estimateOnOrderCumulative(weeks, role) {
    // Approximate outstanding pipeline units:
    // onOrder = Σ(orders - arriving_shipments) over all observed history
    // Do NOT clamp to 0 here; small negatives can happen due to timing, and invPos will handle it.
    let onOrder = 0;
    for (const w of weeks) {
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

    // Forecast demand (EWMA)
    const forecast = ewma(incomingHist, p.lambda);

    // Pipeline estimate
    const onOrder = estimateOnOrderCumulative(weeks, role);

    // Inventory position (CAN be negative!)
    // inventory - backlog + onOrder
    const invPos = (last.inventory - last.backlog) + onOrder;

    // Base-stock target: cover (lead + 1) weeks + safety
    const target = Math.round(forecast * (p.lead + 1) + p.safety);

    // Order-up-to
    let order = Math.round(target - invPos);
    if (order < 0) order = 0;

    // Anti-bullwhip: limit changes from previous order
    order = clamp(order, lastOrder - p.maxStepDown, lastOrder + p.maxStepUp);

    // Cap avoidance: soften near max (prevents hitting caps and creating plateaus)
    if (order > 0.85 * p.max) {
        order = Math.round(0.85 * p.max);
    }

    // Final clamps
    order = Math.max(0, order);
    order = Math.min(order, p.max);

    return order;
}

module.exports = async (req, res) => {
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
            llm_description: "offline tuning / deterministic heuristics",
            student_comment: "Deterministic EWMA + base-stock + inventory-position control with rate limiting"
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
