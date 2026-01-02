const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipSlayer";
const VERSION = "v2.1.0";

const PARAMS = {
    LEAD_TIME: 2,           // Tarneaeg lülide vahel (nädalates) on konstantne.
    INITIAL_ORDER: 12,      // Algne tellimus, kui ajalugu puudub.
    Kp: 0.25,               // Proportsionaalne võimendus (reageerib hetkeveale).
    Ki: 0.18,               // Integraalne võimendus (korrigeerib pikaajalist, kumulatiivset viga).
    FORECAST_WINDOW: 8,     // Mitu viimast nädalat võtta prognoosi aluseks.
    FORECAST_LAMBDA: 0.3,   // EWMA (eksponentsiaalse silumise) silumisfaktor.
    SAFETY_STOCK_WEEKS: 1.8, // Mitu nädalat prognoositud nõudlust hoida puhverlaos.
};

const ROLES = ["retailer", "wholesaler", "distributor", "factory"];

const asInt = (value) => {
    const num = parseInt(value, 10);
    return isNaN(num) ? 0 : num;
};

// Exponentially Weighted Moving Average
function calculateEWMA(values, lambda) {
    if (!values || values.length === 0) return PARAMS.INITIAL_ORDER;
    let forecast = values.length > 0 ? values[0] : PARAMS.INITIAL_ORDER;
    for (let i = 1; i < values.length; i++) {
        forecast = lambda * values[i] + (1 - lambda) * forecast;
    }
    return Math.max(0, forecast);
}

/**
 * Eraldab ja struktureerib ühe rolli kohta käiva ajaloo.
 */
function getRoleHistory(weeks, role) {
    const history = weeks.map(w => ({
        inventory: asInt(w.roles?.[role]?.inventory),
        backlog: asInt(w.roles?.[role]?.backlog),
        incoming_orders: asInt(w.roles?.[role]?.incoming_orders),
        previous_order: asInt(w.orders?.[role]),
    }));

    // Arvutame iga nädala kohta laopositsiooni ja vea.
    let integralError = 0;
    const historyWithMetrics = [];

    for (let i = 0; i < history.length; i++) {
        const weekData = history[i];
        const currentSlice = history.slice(0, i + 1);

        // Torus olev kaup (pipeline) on viimase `LEAD_TIME` nädala jooksul tehtud tellimused.
        const pipeline = currentSlice.slice(-PARAMS.LEAD_TIME).reduce((sum, h) => sum + h.previous_order, 0);
        const inventoryPosition = weekData.inventory - weekData.backlog + pipeline;

        // Sihttase baseerub prognoosil, mis on arvutatud kuni selle hetkeni.
        const demandHistory = currentSlice.map(h => h.incoming_orders);
        const forecast = calculateEWMA(demandHistory.slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);
        const targetInventory = forecast * PARAMS.SAFETY_STOCK_WEEKS;

        const error = targetInventory - inventoryPosition;
        integralError += error;

        historyWithMetrics.push({ ...weekData, inventoryPosition, error, integralError });
    }
    return historyWithMetrics;
}

/**
 * Teeb otsuse ühele rollile, kasutades PI-regulaatori loogikat.
 * @param {string} role - Roll, millele otsust tehakse.
 * @param {Array} weeks - Kogu simulatsiooni ajalugu.
 * @param {number} [demandForecast] - Vabatahtlik parameeter; kui see on antud (GlassBox), kasutatakse seda, muidu arvutatakse rolli enda ajaloost.
 */
function decideForRole(role, weeks, demandForecast) {
    if (weeks.length === 0) return PARAMS.INITIAL_ORDER;

    const history = getRoleHistory(weeks, role);
    const last = history[history.length - 1];

    // Prognoos
    // BlackBox: igaüks prognoosib ise.
    // GlassBox: kasutatakse etteantud jaemüüja prognoosi.
    const forecast = demandForecast !== undefined
        ? demandForecast
        : calculateEWMA(history.map(h => h.incoming_orders).slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);

    const P = PARAMS.Kp * last.error;
    const I = PARAMS.Ki * last.integralError;

    // Uus tellimus = prognoos + korrektsioonid.
    const order = forecast + P + I;

    return Math.round(Math.max(0, order));
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, message: "Method Not Allowed" });
    }

    const body = req.body || {};

    // Handshake
    if (body.handshake === true) {
        return res.status(200).json({
            ok: true,
            student_email: STUDENT_EMAIL,
            algorithm_name: ALGO_NAME,
            version: VERSION,
            supports: { blackbox: true, glassbox: true },
            message: "BeerBot ready",
            uses_llm: false,
            llm_description: "Deterministic PI controller with EWMA forecasting. GlassBox mode uses a coordinated strategy based on retailer demand to eliminate the bullwhip effect.",
            student_comment: "A robust Proportional-Integral (PI) controller corrects long-term supply/demand mismatch, while the GlassBox strategy ensures system-wide stability by synchronizing all roles to the actual end-consumer demand.",
        });
    }

    const { weeks = [], mode = 'blackbox' } = body;
    const orders = {};

    if (mode === 'glassbox' && weeks.length > 0) {
        // GlassBox Strateegia
        const retailerIncomingOrders = weeks.map(w => asInt(w.roles?.retailer?.incoming_orders));
        const demandForecast = calculateEWMA(retailerIncomingOrders.slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);

        for (const role of ROLES) {
            orders[role] = decideForRole(role, weeks, demandForecast);
        }
    } else {
        // BlackBox Strateegia
        for (const role of ROLES) {
            orders[role] = decideForRole(role, weeks);
        }
    }

    return res.status(200).json({ orders });
};