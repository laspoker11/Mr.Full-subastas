import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/auth";
import { Brain, Trophy, Clock3 } from "lucide-react";

const OPTIONS = ["a", "b", "c", "d"];
const OPTION_COLORS = { a: "#e07a3f", b: "#3f8ee0", c: "#5fae5f", d: "#b06fd6" };

export default function ConcursoDuelo() {
  const { id: duelId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [duel, setDuel] = useState(null);
  const [loadingDuel, setLoadingDuel] = useState(true);
  const [opponentName, setOpponentName] = useState("");
  const [myName, setMyName] = useState("");
  const [myAnswers, setMyAnswers] = useState([]);
  const [slot, setSlot] = useState(null);
  const [question, setQuestion] = useState(null);
  const [questionError, setQuestionError] = useState("");
  const [answering, setAnswering] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const loadDuel = useCallback(async () => {
    const { data } = await supabase.from("trivia_duels").select("*").eq("id", duelId).maybeSingle();
    setDuel(data || null);
    setLoadingDuel(false);
  }, [duelId]);

  const loadMyAnswers = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("trivia_duel_answers").select("*").eq("duel_id", duelId).eq("user_id", user.id).order("presented_at", { ascending: true });
    setMyAnswers(data || []);
  }, [duelId, user]);

  useEffect(() => {
    loadDuel();
    loadMyAnswers();
    const channel = supabase
      .channel(`duelo-${duelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_duels", filter: `id=eq.${duelId}` }, loadDuel)
      .on("postgres_changes", { event: "*", schema: "public", table: "trivia_duel_answers", filter: `duel_id=eq.${duelId}` }, loadMyAnswers)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [duelId, loadDuel, loadMyAnswers]);

  useEffect(() => {
    if (!duel || !user) return;
    const opponentId = duel.player1_id === user.id ? duel.player2_id : duel.player1_id;
    const ids = [duel.player1_id, duel.player2_id].filter(Boolean);
    if (!ids.length) return;
    supabase.from("profiles").select("id, full_name").in("id", ids).then(({ data }) => {
      const byId = {};
      (data || []).forEach((p) => (byId[p.id] = p.full_name || "Jugador"));
      setMyName(byId[user.id] || "Tú");
      setOpponentName(opponentId ? byId[opponentId] || "tu rival" : "");
    });
  }, [duel, user]);

  // decide qué slot toca según lo que ya respondió (o dejó pasar) el jugador
  useEffect(() => {
    if (!duel || !user) return;
    if (duel.status === "closed") return;
    if (duel.player1_id !== user.id && duel.player2_id !== user.id) return;

    const answeredCount = myAnswers.filter((a) => a.selected_option !== null).length;
    const nextSlot = duel.status === "tiebreak" ? 5 + duel.tiebreak_round : Math.min(answeredCount + 1, 5);
    setSlot(nextSlot);
  }, [duel, myAnswers, user]);

  useEffect(() => {
    if (!slot || !duel || duel.status === "closed") return;
    let cancelled = false;
    setQuestionError("");
    setQuestion(null);
    (async () => {
      const { data, error } = await supabase.rpc("get_my_duel_question", { p_duel_id: duelId, p_slot: slot });
      if (cancelled) return;
      if (error) return setQuestionError(error.message);
      setQuestion((data && data[0]) || null);
    })();
    return () => { cancelled = true; };
  }, [slot, duelId, duel]);

  async function answer(opt) {
    if (!question || answering) return;
    setAnswering(true);
    const { error } = await supabase.rpc("submit_trivia_answer", {
      p_duel_question_id: question.duel_question_id, p_selected_option: opt,
    });
    setAnswering(false);
    if (error) return setQuestionError(error.message);
    loadMyAnswers();
  }

  function skipToNext() {
    setSlot((s) => Math.min((s || 1) + 1, 5));
  }

  if (authLoading || loadingDuel) return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Cargando...</div>;
  if (!user) return <div style={{ textAlign: "center", padding: 60 }}><Link to="/login">Inicia sesión para jugar</Link></div>;
  if (!duel) return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Ese duelo no existe.</div>;
  if (duel.player1_id !== user.id && duel.player2_id !== user.id) {
    return <div style={{ textAlign: "center", padding: 60, opacity: 0.6 }}>Este duelo no es tuyo.</div>;
  }

  const myCorrect = duel.player1_id === user.id ? duel.p1_correct_count : duel.p2_correct_count;
  const oppCorrect = duel.player1_id === user.id ? duel.p2_correct_count : duel.p1_correct_count;
  const iWon = duel.winner_id === user.id;
  const currentAnswer = question && myAnswers.find((a) => a.duel_question_id === question.duel_question_id);
  const alreadyAnswered = currentAnswer && currentAnswer.selected_option !== null;
  const deadlineMs = question ? new Date(question.deadline).getTime() : null;
  const secondsLeft = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - nowTick) / 1000)) : null;
  const timeUp = secondsLeft === 0;

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 14px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Brain size={20} color="var(--ladrillo)" />
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18 }}>
          {myName || "Tú"} vs {opponentName || "..."}
        </div>
      </div>

      {duel.status === "closed" ? (
        <div className="card" style={{ textAlign: "center", padding: 28 }}>
          {duel.winner_id ? (
            <>
              <Trophy size={36} color="var(--ladrillo)" style={{ marginBottom: 8 }} />
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginBottom: 6 }}>
                {iWon ? "¡Ganaste el duelo!" : `Ganó ${opponentName}`}
              </div>
            </>
          ) : (
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginBottom: 6 }}>
              Ninguno de los dos respondió — quedaron eliminados los dos
            </div>
          )}
          <div style={{ fontSize: 14, opacity: 0.75 }}>
            {myCorrect} de 5 correctas (tú) · {oppCorrect} de 5 correctas ({opponentName})
          </div>
          <Link to="/concurso" className="btn-primary" style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}>
            Volver al concurso
          </Link>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, opacity: 0.7, marginBottom: 16 }}>
            Pregunta {Math.min(slot || 1, 5)} de 5{duel.status === "tiebreak" ? " · ¡Desempate!" : ""}
          </div>

          {questionError && (
            <div className="card" style={{ color: "var(--alerta)", fontSize: 13 }}>{questionError}</div>
          )}

          {question && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{question.question_text}</div>
                {!alreadyAnswered && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: 10,
                    fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 18,
                    color: secondsLeft <= 3 ? "var(--alerta)" : "var(--carbon)",
                  }}>
                    <Clock3 size={16} /> {secondsLeft}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {OPTIONS.map((opt) => {
                  const isMine = currentAnswer?.selected_option === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => answer(opt)}
                      disabled={answering || alreadyAnswered || timeUp}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10,
                        border: isMine ? `2px solid ${OPTION_COLORS[opt]}` : "1px solid var(--crema-suave)",
                        background: isMine ? "var(--crema-suave)" : "white",
                        cursor: alreadyAnswered || timeUp ? "default" : "pointer",
                        fontSize: 14, textAlign: "left", opacity: alreadyAnswered && !isMine ? 0.5 : 1,
                      }}
                    >
                      <span style={{
                        width: 24, height: 24, borderRadius: 6, background: OPTION_COLORS[opt], color: "white",
                        display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, flexShrink: 0,
                      }}>
                        {opt.toUpperCase()}
                      </span>
                      {question[`option_${opt}`]}
                    </button>
                  );
                })}
              </div>

              {alreadyAnswered && (
                <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 10, textAlign: "center" }}>
                  {(slot || 1) < 5 ? "Ya respondiste. Esperando la siguiente..." : "Ya respondiste las 5. Esperando a que termine la ronda..."}
                </div>
              )}
              {timeUp && !alreadyAnswered && (
                <div style={{ marginTop: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 12.5, opacity: 0.7, marginBottom: 6 }}>Se acabó el tiempo de esta pregunta.</div>
                  {(slot || 1) < 5 && (
                    <button className="btn-ghost" onClick={skipToNext} style={{ fontSize: 12.5 }}>Siguiente pregunta →</button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
