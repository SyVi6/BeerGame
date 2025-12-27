package ee.taltech.beerbot.api.dto;

import java.util.Map;

public class HandshakeResponse {
    public boolean ok;
    public String student_email;
    public String algorithm_name;
    public String version;
    public Map<String, Boolean> supports;
    public String message;
    public boolean uses_llm = false;
    public String llm_description = "offline tuning / deterministic heuristics";
    public String student_comment = "Deterministic order-up-to + smoothing controller";
}
