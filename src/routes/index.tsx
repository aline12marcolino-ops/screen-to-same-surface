import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Search, MapPin, Phone, Clock, LocateFixed, Users, Timer, Activity, Building2, Info, LogIn, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CATEGORY_COLOR, CATEGORY_GLYPH, CATEGORY_LABEL, fetchPlaces, geocode, haversineKm, type Place, type Sector } from "@/lib/places";
import { estimateQueue, quietHours, WINDOW_HOURS, type Category, type QueueEvent } from "@/lib/queue";

const HealthMap = lazy(() => import("@/components/HealthMap"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Saúde Inteligente — encontre atendimento perto de você" },
      { name: "description", content: "Farmácias, UBS, AMA, UPA, clínicas e hospitais reais perto de você, com filas e tempo de espera estimados pela comunidade." },
      { property: "og:title", content: "Saúde Inteligente — encontre atendimento perto de você" },
      { property: "og:description", content: "Mapa de estabelecimentos de saúde reais com filas estimadas pela comunidade." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const NA = "Informação não disponível";
const DEFAULT = { lat: -23.5505, lon: -46.6333, label: "Centro de São Paulo" };
const CATS: Category[] = ["hospital", "upa", "ama", "ubs", "clinica", "farmacia"];
const SECTOR_LABEL: Record<Sector, string> = { publico: "Público", particular: "Particular", nao_informado: "Público/particular não informado" };
const LEVEL_LABEL = { baixo: "Baixo", moderado: "Moderado", alto: "Alto" };

function Index() {
  const [center, setCenter] = useState(DEFAULT);
  const [user, setUser] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState(2000);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "todos">("todos");
  const [sector, setSector] = useState<"todos" | Sector>("todos");
  const [only24, setOnly24] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<QueueEvent[]>([]);
  const [locQuery, setLocQuery] = useState("");
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPlaces([]);
    fetchPlaces(center, radius)
      .then((r) => {
        if (!alive) return;
        setPlaces(r.places);
        if (r.fromCache) setError("A fonte de dados está lenta agora. Mostrando os últimos resultados salvos para esta área.");
      })
      .catch(() => alive && setError("A fonte de dados (OpenStreetMap) está sobrecarregada no momento. Tente novamente em instantes."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [center.lat, center.lon, radius, reload]);

  const loadEvents = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data } = await supabase.from("queue_events").select("place_id,kind,created_at").gte("created_at", since).limit(1000);
    setEvents((data ?? []) as QueueEvent[]);
  }, []);
  useEffect(() => {
    loadEvents();
    const t = setInterval(loadEvents, 60_000);
    return () => clearInterval(t);
  }, [loadEvents]);

  const locate = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setUser(p);
        setCenter({ ...p, label: "Sua localização" });
      },
      () => setError("Não conseguimos acessar sua localização. Você pode buscar um bairro ou endereço."),
    );
  };

  const smartSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term || searchingLocation) return;
    const t = term.toLowerCase();
    const matchesLocal = places.some((p) => p.name.toLowerCase().includes(t) || CATEGORY_LABEL[p.category].toLowerCase().includes(t));
    if (matchesLocal) return; // nome/tipo de um local já visível: só filtra
    setSearchingLocation(true);
    setLocationError(null);
    try {
      const r = await geocode(term, center);
      if (!r) {
        setLocationError("Local não encontrado. Inclua a cidade junto com o bairro.");
        return;
      }
      setCenter(r);
      setSelectedId(null);
      setQ("");
      setCat("todos");
      setSector("todos");
      setOnly24(false);
      setReload((n) => n + 1);
    } catch {
      setLocationError("Não foi possível buscar o bairro agora. Tente novamente.");
    } finally {
      setSearchingLocation(false);
    }
  };

  const origin = user ?? center;
  const byPlace = useMemo(() => {
    const m = new Map<string, QueueEvent[]>();
    for (const e of events) m.set(e.place_id, [...(m.get(e.place_id) ?? []), e]);
    return m;
  }, [events]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return places
      .map((p) => ({ ...p, distanceKm: haversineKm(origin, p) }))
      .filter((p) => cat === "todos" || p.category === cat)
      .filter((p) => sector === "todos" || p.sector === sector)
      .filter((p) => !only24 || p.open24h)
      .filter((p) => !term || p.name.toLowerCase().includes(term) || (p.address ?? "").toLowerCase().includes(term) || CATEGORY_LABEL[p.category].toLowerCase().includes(term))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [places, q, cat, sector, only24, origin.lat, origin.lon]);

  const selected = filtered.find((p) => p.id === selectedId) ?? null;
  const recentReports = events.filter((e) => Date.now() - new Date(e.created_at).getTime() < WINDOW_HOURS * 3600_000).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-hero-gradient text-hero-foreground">
        <div className="mx-auto max-w-7xl px-5 pb-10 pt-6">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent font-display text-lg font-extrabold text-accent-foreground">+</span>
              <span className="font-display text-lg font-bold">Saúde Inteligente</span>
            </div>
            <a href="#como-funciona" className="text-sm opacity-80 hover:opacity-100">Como funciona</a>
          </nav>
          <h1 className="mt-10 max-w-3xl font-display text-4xl font-extrabold leading-tight md:text-6xl">
            Encontre atendimento de saúde <span className="text-accent">perto de você.</span>
          </h1>
          <p className="mt-4 max-w-xl opacity-80">
            Farmácias, UBS, AMA, UPA, clínicas e hospitais reais, com movimento e espera estimados pela comunidade.
          </p>
          <div className="mt-8 flex max-w-3xl flex-col gap-3 md:flex-row">
            <form onSubmit={smartSearch} className="flex flex-1 items-center gap-3 rounded-2xl bg-card px-4 py-2 text-foreground shadow-card">
              <Search className="h-5 w-5 text-muted-foreground" />
              <input aria-label="Buscar bairro, endereço ou local" value={q} onChange={(e) => { setQ(e.target.value); setLocationError(null); }} placeholder="Bairro, endereço ou nome do local…" className="w-full bg-transparent py-1.5 outline-none placeholder:text-muted-foreground" />
              <Button type="submit" size="sm" disabled={searchingLocation || !q.trim()}>{searchingLocation ? "Buscando…" : "Buscar"}</Button>
            </form>
            <button type="button" onClick={locate} className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3.5 font-semibold text-accent-foreground transition hover:brightness-105">
              <LocateFixed className="h-5 w-5" /> Usar minha localização
            </button>
          </div>
          {locationError && <p className="mt-2 text-sm text-accent">{locationError}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            <Chip active={cat === "todos"} onClick={() => setCat("todos")}>Todos</Chip>
            {CATS.map((c) => (
              <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</Chip>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Stat icon={<Building2 className="h-4 w-4" />} label="Estabelecimentos na área" value={loading ? "…" : String(places.length)} sub={`raio de ${radius / 1000} km · ${center.label}`} />
          <Stat icon={<Users className="h-4 w-4" />} label="Relatos de fila" value={String(recentReports)} sub={`últimas ${WINDOW_HOURS}h, enviados por cidadãos`} />
          <Stat icon={<Info className="h-4 w-4" />} label="Fonte dos dados" value="OpenStreetMap" sub="unidades reais · atualizado a cada busca" />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3 shadow-card">
          <div className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" /> {center.label}
          </div>
          <Select value={sector} onChange={(v) => setSector(v as typeof sector)} options={[["todos", "Público e particular"], ["publico", "Público"], ["particular", "Particular"]]} />
          <Select value={String(radius)} onChange={(v) => setRadius(+v)} options={[["1000", "Até 1 km"], ["2000", "Até 2 km"], ["3000", "Até 3 km"]]} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={only24} onChange={(e) => setOnly24(e.target.checked)} className="accent-primary" />
            Abertos agora (24h confirmado)
          </label>
        </div>

        {locationError && <p role="alert" className="mt-4 text-sm text-destructive">{locationError}</p>}
        {error && (
          <p className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
            <button onClick={() => setReload((n) => n + 1)} className="font-semibold underline">Tentar novamente</button>
          </p>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_420px]">
          <div className="h-[460px] overflow-hidden rounded-2xl border shadow-card lg:h-[680px]">
            <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-muted" />}>
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted" />}>
                <HealthMap center={center} user={user} places={filtered} selectedId={selectedId} onSelect={setSelectedId} />
              </Suspense>
            </ClientOnly>
          </div>

          <div className="flex flex-col gap-3 lg:h-[680px] lg:overflow-y-auto lg:pr-1">
            {selected && <Detail place={selected} events={byPlace.get(selected.id) ?? []} onReported={loadEvents} onClose={() => setSelectedId(null)} />}
            <p className="text-sm text-muted-foreground">{loading ? "Buscando estabelecimentos…" : `${filtered.length} resultados`}</p>
            {filtered.slice(0, 80).map((p) => (
              <PlaceCard key={p.id} place={p} events={byPlace.get(p.id) ?? []} active={p.id === selectedId} onClick={() => setSelectedId(p.id)} />
            ))}
            {!loading && !error && filtered.length === 0 && <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">Nenhum estabelecimento com esses filtros.</p>}
          </div>
        </div>

        <section id="como-funciona" className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            ["Dados reais", "Nomes, endereços e localização vêm do OpenStreetMap. Quando algo não está cadastrado, mostramos “Informação não disponível”."],
            ["Filas colaborativas", "Ao chegar ou sair de uma unidade, registre sua entrada ou saída. Isso alimenta a estimativa de pessoas aguardando."],
            ["Estimativas, não dados oficiais", "Tempo de espera e movimento são estimativas da comunidade e não representam informação oficial do estabelecimento."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border bg-card p-5 shadow-card">
              <h3 className="font-display text-lg font-bold">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
        <footer className="py-10 text-center text-xs text-muted-foreground">Dados de estabelecimentos © colaboradores do OpenStreetMap. Em emergência, ligue 192 (SAMU).</footer>
      </main>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-secondary"}`}>
      {children}
    </button>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border bg-card px-3 py-2 text-sm">
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="text-primary">{icon}</span>{label}</div>
      <div className="mt-1 font-display text-3xl font-extrabold">{value}</div>
      <div className="break-words text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function CatBadge({ c }: { c: Category }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-primary-foreground" style={{ background: CATEGORY_COLOR[c] }}>
      {CATEGORY_GLYPH[c]}
    </span>
  );
}

function LevelPill({ level }: { level: "baixo" | "moderado" | "alto" }) {
  const cls = { baixo: "bg-level-baixo", moderado: "bg-level-moderado", alto: "bg-level-alto" }[level];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-primary-foreground ${cls}`}>{LEVEL_LABEL[level]}</span>;
}

function PlaceCard({ place, events, active, onClick }: { place: Place; events: QueueEvent[]; active: boolean; onClick: () => void }) {
  const est = estimateQueue(events, place.category);
  return (
    <button onClick={onClick} className={`flex gap-3 rounded-2xl border bg-card p-4 text-left shadow-card transition hover:border-primary ${active ? "border-primary ring-2 ring-primary/20" : ""}`}>
      <CatBadge c={place.category} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-snug">{place.name}</h3>
          <span className="shrink-0 text-xs text-muted-foreground">{place.distanceKm?.toFixed(1) ?? "—"} km</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{CATEGORY_LABEL[place.category]} · {SECTOR_LABEL[place.sector]}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{place.address ?? NA}</p>
        <div className="mt-2 text-xs">
          {est.reports > 0 ? (
            <span className="flex items-center gap-2"><LevelPill level={est.level} /> ~{est.waitMinutes} min · estimativa</span>
          ) : (
            <span className="text-muted-foreground">Fila: sem relatos recentes</span>
          )}
        </div>
      </div>
    </button>
  );
}

function Detail({ place, events, onReported, onClose }: { place: Place; events: QueueEvent[]; onReported: () => void; onClose: () => void }) {
  const est = estimateQueue(events, place.category);
  const hours = quietHours(events);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const report = async (kind: "entrada" | "saida") => {
    setSending(true);
    const { error } = await supabase.from("queue_events").insert({ place_id: place.id, kind });
    setSending(false);
    setMsg(error ? "Não foi possível registrar. Tente novamente." : kind === "entrada" ? "Entrada registrada. Obrigado!" : "Saída registrada. Obrigado!");
    if (!error) onReported();
  };

  return (
    <div className="rounded-2xl border-2 border-primary bg-card p-5 shadow-card">
      <div className="flex items-start gap-3">
        <CatBadge c={place.category} />
        <div className="flex-1">
          <h2 className="font-display text-xl font-bold leading-tight">{place.name}</h2>
          <p className="text-sm text-muted-foreground">{CATEGORY_LABEL[place.category]} · {SECTOR_LABEL[place.sector]} · {place.distanceKm?.toFixed(1) ?? "—"} km</p>
        </div>
        <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Fechar</button>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        <li className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 text-primary" />{place.address ?? NA}</li>
        <li className="flex gap-2"><Phone className="h-4 w-4 shrink-0 text-primary" />{place.phone ? <a href={`tel:${place.phone}`} className="underline">{place.phone}</a> : NA}</li>
        <li className="flex gap-2"><Clock className="h-4 w-4 shrink-0 text-primary" />{place.hours === "24/7" ? "24 horas" : place.hours ?? NA}</li>
      </ul>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted p-3 text-center">
        <div><Users className="mx-auto h-4 w-4 text-primary" /><div className="font-display text-xl font-bold">{est.reports ? est.people : "—"}</div><div className="text-[11px] text-muted-foreground">aguardando</div></div>
        <div><Timer className="mx-auto h-4 w-4 text-primary" /><div className="font-display text-xl font-bold">{est.reports ? `${est.waitMinutes}′` : "—"}</div><div className="text-[11px] text-muted-foreground">espera</div></div>
        <div><Activity className="mx-auto h-4 w-4 text-primary" /><div className="mt-1">{est.reports ? <LevelPill level={est.level} /> : "—"}</div><div className="mt-1 text-[11px] text-muted-foreground">movimento</div></div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {est.reports ? `Estimativa baseada em ${est.reports} relato(s) de cidadãos nas últimas ${WINDOW_HOURS}h. Não é informação oficial.` : "Dados de fila indisponíveis: ainda não há relatos recentes para esta unidade."}
      </p>
      <p className="mt-2 text-sm"><span className="font-semibold">Horários com menor movimento: </span>{hours ? hours.map((h) => `${h}h`).join(", ") + " (estimativa)" : "dados insuficientes"}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button disabled={sending} onClick={() => report("entrada")} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"><LogIn className="h-4 w-4" />Cheguei na fila</button>
        <button disabled={sending} onClick={() => report("saida")} className="flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold disabled:opacity-50"><LogOut className="h-4 w-4" />Fui atendido</button>
      </div>
      {msg && <p className="mt-2 text-xs text-primary">{msg}</p>}
      <a href={`https://www.openstreetmap.org/directions?to=${place.lat},${place.lon}`} target="_blank" rel="noreferrer" className="mt-3 block text-center text-xs text-primary underline">Como chegar</a>
    </div>
  );
}
