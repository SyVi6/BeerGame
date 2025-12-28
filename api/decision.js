const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.7";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];
const ROLE_PARAMS = {
    retailer:    { lead: 2, safety: 2, lambda: 0.35, smooth: 0.55, up: 35, down: 45, max: 220 },
    wholesaler:  { lead: 2, safety: 2, lambda: 0.33, smooth: 0.55, up: 30, down: 40, max: 200 },
    distributor: { lead: 2, safety: 1, lambda: 0.30, smooth: 0.60, up: 28, down: 38, max: 190 },
    factory:     { lead: 2, safety: 1, lambda: 0.27, smooth: 0.65, up: 25, down: 35, max: 180 }
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

function estimateOnOrderFinite(weeks, role, lead) {
    const start = Math.max(0, weeks.length - lead);
    let onOrder = 0;
    for (let i = start; i < weeks.length; i++) {
        const w = weeks[i];
        const shipped = getRoleState(w, role).arriving_shipments;
        const ordered = getPrevOrder(w, role);
        onOrder += (ordered - shipped);
    }
    return Math.max(0, onOrder);
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

    // Demand estimate (short EWMA) — reacts, but not too aggressively
    const demand = ewma(incomingHist.slice(-8), p.lambda);

    // Pipeline estimate (finite)
    const onOrder = estimateOnOrderFinite(weeks, role, p.lead);

    // Inventory position (includes backlog)
    const invPos = (last.inventory - last.backlog) + onOrder;

    // Target base-stock (cover lead + 1 weeks)
    const target = Math.round(demand * (p.lead + 1) + p.safety);

    // Raw order-up-to
    let order = Math.round(target - invPos);
    if (order < 0) order = 0;

    order = Math.round(p.smooth * lastOrder + (1 - p.smooth) * order);

    // Rate limit (anti-bullwhip)
    order = clamp(order, lastOrder - p.down, lastOrder + p.up);

    // Final clamps
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

    if (body.handshake === true) {
        res.status(200).json({
            ok: true,
            student_email: STUDENT_EMAIL,
            algorithm_name: ALGO_NAME,
            version: VERSION,
            supports: { blackbox: true, glassbox: true },
            uses_llm: false,
            message: "Deterministic base-stock + finite pipeline + smoothing + rate limiting"
        });
        return;
    }

    const weeks = Array.isArray(body.weeks) ? body.weeks : [];
    const orders = {};
    for (const role of ROLES) {
        orders[role] = decideForRole(role, weeks);
    }

    res.status(200).json({ orders });
};
