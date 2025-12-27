package ee.taltech.beerbot.logic;

public class RoleState {
    public int inventory;
    public int backlog;
    public int incomingOrders;
    public int arrivingShipments;

    public RoleState(int inventory, int backlog, int incomingOrders, int arrivingShipments) {
        this.inventory = Math.max(0, inventory);
        this.backlog = Math.max(0, backlog);
        this.incomingOrders = Math.max(0, incomingOrders);
        this.arrivingShipments = Math.max(0, arrivingShipments);
    }
}
