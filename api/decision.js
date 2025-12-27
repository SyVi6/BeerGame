const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.0";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];

// Tunable constants (deterministic)
const PIPELINE_WEEKS = 2;
const SAFETY_STOCK = 8;
const EWMA_LAMBDA = 0.40;
const ORDER_SMOOTH_BETA = 0.55;
const MAX_ORDER = 500;

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

function decideForRole(role, weeks) {
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

    const forecast = ewma(incomingHist, EWMA_LAMBDA);

    // inventory position approximation: inventory - backlog + arriving_shipments
    const invPos = Math.max(0, last.inventory - last.backlog + last.arriving_shipments);

    // target position: cover (pipeline+1) weeks + safety buffer
    const target = Math.max(0, Math.round(forecast * (PIPELINE_WEEKS + 1) + SAFETY_STOCK));

    let rawOrder = target - invPos;
    if (rawOrder < 0) rawOrder = 0;

    // small deterministic backlog nudge
    rawOrder += Math.round(0.15 * last.backlog);

    const lastOrder = prevOrders[prevOrders.length - 1] || 0;
    const smoothed = Math.round((1 - ORDER_SMOOTH_BETA) * rawOrder + ORDER_SMOOTH_BETA * lastOrder);

    return clampNonNegInt(smoothed);
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
