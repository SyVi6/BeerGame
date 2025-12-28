const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipBreaker";
const VERSION = "v1.0.5";

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];
const ROLE_PARAMS = {
    retailer:    { lead: 2, safetyWeeks: 1.0, safetyUnits: 2, lambda: 0.55, a: 0.35, b: 0.20, up: 30, down: 60, max: 120 },
    wholesaler:  { lead: 2, safetyWeeks: 0.9, safetyUnits: 2, lambda: 0.50, a: 0.28, b: 0.18, up: 24, down: 55, max: 110 },
    distributor: { lead: 2, safetyWeeks: 0.8, safetyUnits: 1, lambda: 0.45, a: 0.22, b: 0.16, up: 20, down: 50, max: 100 },
    factory:     { lead: 2, safetyWeeks: 0.7, safetyUnits: 1, lambda: 0.40, a: 0.18, b: 0.14, up: 16, down: 45, max: 90  }
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

/**
 * Pipeline estimate: outstanding orders not yet received.
 * Use a window to avoid history drift, and clamp to >=0 for stability.
 */
function estimatePipeline(weeks, role, window) {
    const start = Math.max(0, weeks.length - window);
    let pipe = 0;
    for (let i = start; i < weeks.length; i++) {
        const w = weeks[i];
        const o = getPrevOrder(w, role);
        const rs = getRoleState(w, role);
        pipe += (o - rs.arriving_shipments);
    }
    // pipeline cannot be negative in reality; clamp to 0 to avoid weirdness
    return Math.max(0, pipe);
}

/**
 * Global demand signal (GlassBox-friendly):
 * Use retailer incoming_orders history as "true customer demand"
 * and feed the same forecast upstream to reduce bullwhip.
 */
function getGlobalDemandHistory(weeks) {
    const hist = [];
    for (const w of weeks) {
        const r = getRoleState(w, "retailer");
        hist.push(r.incoming_orders);
    }
    return hist;
}

function decideForRole(role, weeks, globalForecast) {
    const p = ROLE_PARAMS[role] || ROLE_PARAMS.retailer;
    if (!weeks || weeks.length === 0) return 10;

    const lastWeek = weeks[weeks.length - 1];
    const last = getRoleState(lastWeek, role);
    const lastOrder = getPrevOrder(lastWeek, role);

    // Forecast demand: use global forecast for all roles (damps bullwhip)
    const forecast = globalForecast;

    // Desired levels
    const desiredInv = Math.round(forecast * p.safetyWeeks + p.safetyUnits);
    const desiredPipe = Math.round(forecast * p.lead);

    // Current levels
    const netInv = last.inventory - last.backlog; // can be negative
    const pipeline = estimatePipeline(weeks, role, p.lead + 2);

    // Sterman adjustments
    const invAdj = p.a * (desiredInv - netInv);
    const pipeAdj = p.b * (desiredPipe - pipeline);

    let desiredOrder = Math.round(forecast + invAdj + pipeAdj);
    if (desiredOrder < 0) desiredOrder = 0;

    // Rate limiting: allow faster downward correction to avoid inventory piles
    let order = clamp(desiredOrder, lastOrder - p.down, lastOrder + p.up);

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
            student_comment: "Sterman anchor&adjust + pipeline control + shared demand forecast to reduce bullwhip"
        });
        return;
    }

    const weeks = Array.isArray(body.weeks) ? body.weeks : [];

    // Global forecast from retailer incoming orders
    const demandHist = getGlobalDemandHistory(weeks);
    const globalForecast = ewma(demandHist, ROLE_PARAMS.retailer.lambda);

    const orders = {};
    for (const role of ROLES) {
        orders[role] = decideForRole(role, weeks, globalForecast);
    }

    res.status(200).json({ orders });
};
