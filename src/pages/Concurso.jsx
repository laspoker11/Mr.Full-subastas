import { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/auth";
import { trackConversion } from "../lib/activity";
import { Brain, Trophy, Swords } from "lucide-react";

const STATUS_LABELS = {
  draft: "Próximamente",
  signups_open: "Inscripciones abiertas",
  in_progress: "En curso",
  closed: "Terminado",
  cancelled: "Cancelado",
};

const ROUND_STATUS_LABELS = { scheduled: "Programada", open: "Jugándose ahora", closed: "Cerrada" };

export default function Concurso() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [contests, setContests] = useState([]);
  const [mySignups, setMySignups] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [errorById, setErrorById] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [bracketByContest, setBracketByContest] = useState({});
  const [activeDuel, setActiveDuel] = useState(null);

  const loadActiveDuel = useCallback(async () => {
    if (!user) return setActiveDuel(null);
    const { data } = await supabase
      .from("trivia_duels").select("*")
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
      .in("status", ["pending", "tiebreak"])
      .limit(1);
    setActiveDuel((data && data[0]) || null);
  }, [user]);

  const load = useCallback(async () => {
    const { data: c } = await supabase
      .from("trivia_contests").select("*")
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(30);
    setContests(c || []);
    setLoading(false);
  }, []);

  const loadMySignups = useCallback(async () => {
    if (!user) return setMySignups({});
    const { data } = await supabase.from("trivia_signups").select("*").eq("user_id", user.id);
    const map = {};
    (data || []).forEach((s) => (map[s.contest_id] = s));
    setMySignups(map);
  }, [user]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("concurso-publico")
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_contests" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  useEffect(() => {
    loadMySignups();
  }, [loadMySignups]);

  useEffect(() => {
    loadActiveDuel();
    if (!user) return;
    const channel = supabase
      .channel(`concurso-mis-duelos-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_duels" }, loadActiveDuel)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user, loadActiveDuel]);

  async function signup(contest) {
    if (!user) return navigate("/login");
    setErrorById((prev) => ({ ...prev, [contest.id]: "" }));
    setBusyId(contest.id);
    const { error } = await supabase.rpc("trivia_signup", { p_contest_id: contest.id });
    setBusyId(null);
    if (error) return setErrorById((prev) => ({ ...prev, [contest.id]: error.message }));
    trackConversion(user.id, "inscripcion_concurso", location.pathname, { contest_id: contest.id });
    loadMySignups();
  }

  async function toggleBracket(contest) {
    if (expandedId === contest.id) return setExpandedId(null);
    setExpandedId(contest.id);
    if (bracketByContest[contest.id]) return;

    const { data: rounds } = await supabase
      .from("trivia_contest_rounds").select("*").eq("contest_id", contest.id).order("round_number", { ascending: true });
    const { data: duels } = await supabase
      .from("trivia_duels").select("*").in("round_id", (rounds || []).map((r) => r.id));

    const playerIds = [...new Set((duels || []).flatMap((d) => [d.player1_id, d.player2_id]).filter(Boolean))];
    const { data: profiles } = playerIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", playerIds)
      : { data: [] };
    const nameById = {};
    (profiles || []).forEach((p) => (nameById[p.id] = p.full_name || "Jugador"));

    setBracketByContest((prev) => ({ ...prev, [contest.id]: { rounds: rounds || [], duels: duels || [], nameById } }));
  }

  if (loading) return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Cargando...</div>;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 14px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Brain size={22} color="var(--ladrillo)" />
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22 }}>Concurso</div>
      </div>
      <div style={{ fontSize: 13.5, opacity: 0.7, marginBottom: 18 }}>
        Torneo de cultura general con duelos 1 vs 1 de eliminación directa. Inscríbete y espera a que abra tu duelo.
      </div>

      {activeDuel && (
        <Link
          to={`/concurso/duelo/${activeDuel.id}`}
          className="card"
          style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 16, textDecoration: "none", color: "white",
            background: "var(--ladrillo)",
          }}
        >
          <Swords size={20} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              {activeDuel.status === "tiebreak" ? "¡Tu duelo está en desempate!" : "¡Tienes un duelo activo!"}
            </div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>Toca aquí para jugar ahora →</div>
          </div>
        </Link>
      )}

      {contests.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.6 }}>Todavía no hay ningún concurso abierto.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {contests.map((c) => {
            const signup_ = mySignups[c.id];
            const bracket = bracketByContest[c.id];
            return (
              <div key={c.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16 }}>{c.title}</div>
                    {c.description && <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>{c.description}</div>}
                    <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 4 }}>{STATUS_LABELS[c.status] || c.status}</div>
                  </div>
                  {c.status === "signups_open" && !signup_ && (
                    <button className="btn-primary" onClick={() => signup(c)} disabled={busyId === c.id} style={{ flexShrink: 0, fontSize: 12.5 }}>
                      {busyId === c.id ? "..." : "Inscribirme"}
                    </button>
                  )}
                  {signup_ && (
                    <div style={{
                      fontSize: 11.5, fontWeight: 700, flexShrink: 0, padding: "4px 10px", borderRadius: 20,
                      background: signup_.status === "ganador" ? "var(--ladrillo)" : "var(--crema-suave)",
                      color: signup_.status === "ganador" ? "white" : "var(--carbon)",
                    }}>
                      {signup_.status === "inscrito" ? "Inscrito" : signup_.status === "eliminado" ? "Eliminado" : "🏆 Ganador"}
                    </div>
                  )}
                </div>
                {errorById[c.id] && <div style={{ color: "var(--alerta)", fontSize: 12, marginTop: 6 }}>{errorById[c.id]}</div>}

                {c.status !== "signups_open" && (
                  <button className="btn-ghost" onClick={() => toggleBracket(c)} style={{ fontSize: 12, marginTop: 8 }}>
                    {expandedId === c.id ? "Ocultar rondas" : "Ver rondas"}
                  </button>
                )}

                {expandedId === c.id && bracket && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                    {bracket.rounds.length === 0 ? (
                      <div style={{ fontSize: 12, opacity: 0.6 }}>Todavía no hay rondas programadas.</div>
                    ) : (
                      bracket.rounds.map((r) => (
                        <div key={r.id}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>
                            {r.round_name} · {ROUND_STATUS_LABELS[r.status] || r.status}
                            {r.prize_description ? ` · 🎁 ${r.prize_description}` : ""}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {bracket.duels.filter((d) => d.round_id === r.id).map((d) => (
                              <div key={d.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--crema-suave)" }}>
                                <span>
                                  {d.is_bye
                                    ? `${bracket.nameById[d.player1_id] || "?"} (pase directo)`
                                    : `${bracket.nameById[d.player1_id] || "?"} vs ${bracket.nameById[d.player2_id] || "?"}`}
                                </span>
                                <span style={{ opacity: 0.7 }}>
                                  {d.status === "closed"
                                    ? (d.winner_id ? `Ganó ${bracket.nameById[d.winner_id] || "?"}` : "Ambos eliminados")
                                    : d.status === "tiebreak" ? "Desempate..." : "Jugando..."}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                    {c.status === "closed" && c.winner_user_id && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13 }}>
                        <Trophy size={16} color="var(--ladrillo)" /> Campeón: {bracket.nameById[c.winner_user_id] || "..."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
