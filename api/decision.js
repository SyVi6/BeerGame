const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.0";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];
const ROLE_PARAMS = {
    retailer:   { L: 2, safety: 6,  lambda: 0.35, k: 0.55, beta: 0.45, up: 60,  down: 60,  max: 250 },
    wholesaler: { L: 2, safety: 5,  lambda: 0.35, k: 0.45, beta: 0.55, up: 50,  down: 50,  max: 220 },
    distributor:{ L: 2, safety: 4,  lambda: 0.35, k: 0.35, beta: 0.65, up: 40,  down: 40,  max: 200 },
    factory:    { L: 2, safety: 3,  lambda: 0.35, k: 0.28, beta: 0.70, up: 30,  down: 30,  max: 180 }
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

function clampNonNegInt(n) {
    n = asInt(n);
    if (n < 0) return 0;
    if (n > MAX_ORDER) return MAX_ORDER;
    return n;
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

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function estimateOnOrder(weeks, role, L) {
    // Sum over last L weeks: orders - arriving_shipments
    const start = Math.max(0, weeks.length - L);
    let onOrder = 0;
    for (let i = start; i < weeks.length; i++) {
        const w = weeks[i];
        const rs = getRoleState(w, role);
        const o = getPrevOrder(w, role);
        onOrder += (o - rs.arriving_shipments);
    }
    return Math.max(0, onOrder);
}

function decideForRole(role, weeks) {
    const p = ROLE_PARAMS[role] || ROLE_PARAMS.retailer;
    if (!weeks || weeks.length === 0) return 10;

    // histories
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

    // Forecast demand with EWMA
    const forecast = ewma(incomingHist, p.lambda);

    // Estimate pipeline/on-order
    const onOrder = estimateOnOrder(weeks, role, p.L);

    // Inventory position
    const invPos = Math.max(0, last.inventory - last.backlog + onOrder);

    // Target base-stock: cover (L+1) weeks + safety
    const target = Math.max(0, Math.round(forecast * (p.L + 1) + p.safety));

    // Error and damped correction
    const error = target - invPos;

    // Controller: lastOrder + k * error
    let order = Math.round(lastOrder + p.k * error);

    // Extra smoothing toward last order (optional damping)
    order = Math.round((1 - p.beta) * order + p.beta * lastOrder);

    // Rate limit (prevents spikes / bullwhip)
    order = clamp(order, lastOrder - p.down, lastOrder + p.up);

    // Non-negative and role max cap
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
            student_comment: "Deterministic order-up-to + smoothing controller"
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
