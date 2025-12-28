const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.8";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];
const ROLE_PARAMS = {
    retailer:    { lead: 2, lambda: 0.35, safety: 1, Kp: 0.18, backlogFrac: 0.12, deadband: 6, stepUp: 10, stepDown: 14, max: 80 },
    wholesaler:  { lead: 2, lambda: 0.30, safety: 1, Kp: 0.16, backlogFrac: 0.10, deadband: 7, stepUp: 9,  stepDown: 13, max: 80 },
    distributor: { lead: 2, lambda: 0.28, safety: 1, Kp: 0.14, backlogFrac: 0.08, deadband: 8, stepUp: 8,  stepDown: 12, max: 80 },
    factory:     { lead: 2, lambda: 0.25, safety: 1, Kp: 0.12, backlogFrac: 0.06, deadband: 9, stepUp: 7,  stepDown: 11, max: 80 },
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
        arriving_shipments: Math.max(0, asInt(r.arriving_shipments)),
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
        const rs = getRoleState(w, role);
        const o = getPrevOrder(w, role);
        onOrder += (o - rs.arriving_shipments);
    }
    return onOrder;
}

function tail(arr, n) {
    if (!arr || arr.length <= n) return arr || [];
    return arr.slice(arr.length - n);
}

function decideForRole(role, weeks) {
    const p = ROLE_PARAMS[role] || ROLE_PARAMS.retailer;
    if (!weeks || weeks.length === 0) return 10;

    // histories
    const incomingHist = [];
    const orderHist = [];

    for (const w of weeks) {
        const rs = getRoleState(w, role);
        incomingHist.push(rs.incoming_orders);
        orderHist.push(getPrevOrder(w, role));
    }

    const lastWeek = weeks[weeks.length - 1];
    const last = getRoleState(lastWeek, role);
    const lastOrder = orderHist[orderHist.length - 1] || 0;

    // 1) Forecast: EWMA viimase 8 nädala incoming_orders peal
    const forecast = ewma(tail(incomingHist, 8), p.lambda);

    // 2) Pipeline (finite, lead-based)
    const onOrder = estimateOnOrderFinite(weeks, role, p.lead);

    // 3) Inventory position: inv - backlog + pipeline
    const invPos = (last.inventory - last.backlog) + onOrder;

    // 4) Target invPos: cover lead+1 + safety (väike safety)
    const targetInvPos = Math.round(forecast * (p.lead + 1) + p.safety);

    const error = targetInvPos - invPos;
    const backlogBleed = (last.backlog > 0)
        ? Math.min(last.backlog, Math.round((last.backlog * p.backlogFrac) + (last.backlog / (p.lead + 1))))
        : 0;

    let orderRaw = forecast + p.Kp * error + backlogBleed;

    // 7) Deadband: kui viga on väike, ära muuda (hoiab stabiilsust)
    if (Math.abs(error) <= p.deadband) {
        orderRaw = forecast;
    }

    let order = Math.round(0.65 * orderRaw + 0.35 * lastOrder);

    // 9) Rate limit (anti-bullwhip)
    order = clamp(order, lastOrder - p.stepDown, lastOrder + p.stepUp);

    // 10) Bounds
    order = Math.max(0, Math.min(p.max, order));

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
            llm_description: "Deterministic control heuristics (EWMA + inventory-position feedback + deadband + rate limiting)",
            student_comment: "Stable-demand ordering with small inventory-position corrections and slow backlog bleed to reduce bullwhip.",
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
