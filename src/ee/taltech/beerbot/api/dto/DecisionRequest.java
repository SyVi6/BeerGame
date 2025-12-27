package ee.taltech.beerbot.api.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

@JsonIgnoreProperties(ignoreUnknown = true)
public class DecisionRequest {
    // Handshake fields
    public Boolean handshake;
    public String ping;
    public Integer seed;

    // Weekly simulation fields
    public String mode;          // "blackbox" | "glassbox"
    public Integer week;
    public Integer weeks_total;
    public List<Map<String, Object>> weeks; // parse as generic; we map safely in logic
}
