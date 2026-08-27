import { waLink, waGeneralMessage } from "../lib/whatsapp";
import { useAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";

export default function WhatsAppFloatingButton() {
  const { user } = useAuth();
  return (
    <a
      href={waLink(waGeneralMessage())}
      target="_blank"
      rel="noopener noreferrer"
      title="Escríbenos por WhatsApp"
      onClick={() => logActivity(user?.id, "click", location.pathname, "whatsapp_flotante")}
      style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 50,
        width: 54, height: 54, borderRadius: "50%", background: "#25D366",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)", textDecoration: "none",
        fontSize: 26,
      }}
    >
      💬
    </a>
  );
}
