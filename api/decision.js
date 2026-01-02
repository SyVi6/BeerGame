const STUDENT_EMAIL = "siveri@taltech.ee";
const ALGO_NAME = "BullwhipSlayer";
const VERSION = "v2.3.0";

const PARAMS = {
    LEAD_TIME: 2,           // Tarneaeg lülide vahel (nädalates) on konstantne.
    INITIAL_ORDER: 12,      // Algne tellimus, kui ajalugu puudub.
    Kp: 0.30,               // Proportsionaalne võimendus (reageerib hetkeveale).
    Ki: 0.22,               // Integraalne võimendus (korrigeerib pikaajalist, kumulatiivset viga).
    INTEGRAL_CLAMP: 70,     // Anti-Windup: integraalviga ei saa minna üle +/- selle väärtuse. KÕIGE OLULISEM PARANDUS!
    ORDER_SMOOTHING: 0.75,   // 40% uus arvutus + 60% eelmine tellimus. Summutab võnkumisi.
    MAX_STEP_CHANGE: 30,    // Rate Limiting: tellimus ei saa muutuda nädalas rohkem kui see väärtus.
    FORECAST_WINDOW: 10,     // Mitu viimast nädalat võtta prognoosi aluseks.
    FORECAST_LAMBDA: 0.3,   // EWMA (eksponentsiaalse silumise) silumisfaktor.
    SAFETY_STOCK_WEEKS: 1.2, // Mitu nädalat prognoositud nõudlust hoida puhverlaos.
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
 * Arvutab otsuse ühele rollile, kasutades lõplikku, häälestatud regulaatorit.
 */
function decideForRole(role, weeks, demandForecast) {
    const historyLength = weeks.length;
    if (historyLength === 0) return PARAMS.INITIAL_ORDER;

    // Ajaloo eraldamine on selgem ja väldib korduvaid tsükleid.
    const history = weeks.map(w => ({
        demand: asInt(w.roles?.[role]?.incoming_orders),
        inventory: asInt(w.roles?.[role]?.inventory),
        backlog: asInt(w.roles?.[role]?.backlog),
        order: asInt(w.orders?.[role]),
    }));

    const lastState = history[historyLength - 1];
    const lastOrder = historyLength > 1 ? history[historyLength - 2].order : PARAMS.INITIAL_ORDER;

    const forecast = demandForecast !== undefined
        ? demandForecast
        : calculateEWMA(history.map(h => h.demand).slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);

    // Täpsem "on-order" arvutus, mis vaatab ainult viimaseid tellimusi tarneaja sees.
    const onOrder = history.slice(-PARAMS.LEAD_TIME).reduce((sum, h) => sum + h.order, 0);

    const inventoryPosition = lastState.inventory - lastState.backlog + onOrder;
    const targetInvPos = forecast * (PARAMS.LEAD_TIME + PARAMS.SAFETY_STOCK_WEEKS);

    const currentError = targetInvPos - inventoryPosition;

    // Integraalviga arvutatakse kogu ajaloost, kuid see on viimane samm, mitte tsükli sees.
    const totalIntegralError = history.reduce((sum, h, i) => {
        const pastOnOrder = history.slice(Math.max(0, i - PARAMS.LEAD_TIME), i).reduce((s, ho) => s + ho.order, 0);
        const pastInvPos = h.inventory - h.backlog + pastOnOrder;
        const pastTarget = forecast * (PARAMS.LEAD_TIME + PARAMS.SAFETY_STOCK_WEEKS); // lihtsustatud, kasutab viimast prognoosi
        const pastError = pastTarget - pastInvPos;
        return sum + pastError;
    }, 0);

    const integralError = Math.max(-PARAMS.INTEGRAL_CLAMP, Math.min(PARAMS.INTEGRAL_CLAMP, totalIntegralError));

    const P = PARAMS.Kp * currentError;
    const I = PARAMS.Ki * integralError;
    const rawOrder = forecast + P + I;

    const smoothedOrder = PARAMS.ORDER_SMOOTHING * rawOrder + (1 - PARAMS.ORDER_SMOOTHING) * lastOrder;

    const finalOrder = Math.max(
        lastOrder - PARAMS.MAX_STEP_CHANGE,
        Math.min(lastOrder + PARAMS.MAX_STEP_CHANGE, smoothedOrder)
    );

    return Math.round(Math.max(0, finalOrder));
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
            llm_description: "A finely-tuned, responsive PI controller. Parameters are balanced for aggressive backlog clearing and minimal inventory overshoot, targeting top-tier performance.",
            student_comment: "Final version: Increased controller gains and relaxed stabilizers for a faster, more adaptive response to demand changes, aiming to minimize total cost across the entire simulation.",
        });
    }

    const { weeks = [], mode = 'blackbox' } = body;
    const orders = {};

    if (mode === 'glassbox' && weeks.length > 0) {
        const retailerDemandHistory = weeks.map(w => asInt(w.roles?.retailer?.incoming_orders));
        const demandForecast = calculateEWMA(retailerDemandHistory.slice(-PARAMS.FORECAST_WINDOW), PARAMS.FORECAST_LAMBDA);
        for (const role of ROLES) {
            orders[role] = decideForRole(role, weeks, demandForecast);
        }
    } else {
        for (const role of ROLES) {
            orders[role] = decideForRole(role, weeks);
        }
    }

    return res.status(200).json({ orders });
};