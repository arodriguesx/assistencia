const App = (() => {
  const KEY = "tecnoassist_db_v4";
  const SKEY = "tecnoassist_sess";   // sessão atual (utilizador) — sobrevive a refresh
  const PKEY = "tecnoassist_page";   // última página aberta
  // fluxo linear (cancelada é uma saída, não entra na sequência)
  const ESTADOS = ["registado","diagnostico","orcamento","manutencao","finalizado","entregue"];
  const ESTADO_LABEL = {
    registado:"Registado", diagnostico:"Diagnóstico", orcamento:"Orçamento",
    manutencao:"Manutenção", finalizado:"Finalizado", entregue:"Entregue", cancelada:"Cancelada"
  };
  const ESTADO_HINT = {
    registado:"cliente deixou o equipamento", diagnostico:"técnico avalia o problema",
    orcamento:"aguarda aprovação do cliente", manutencao:"reparo ou troca de peças",
    finalizado:"disponível para retirada", entregue:"cliente recebeu o equipamento", cancelada:"serviço não realizado"
  };
  const ROLE_LABEL = {operador:"Utilizador", responsavel:"Responsável técnico", admin:"Administrador"};
  const TAXA_PRIORIDADE = {normal:1000, urgente:2000}; // sugestão de taxa de diagnóstico (CVE)
  const FLOW = ESTADOS.map(k=>({key:k, label:ESTADO_LABEL[k]}));
  // quem pode avançar PARA FORA de cada estado -> próximo estado
  const ADVANCE_PERM = {
    registado:   ["responsavel","admin"],            // responsável dá seguimento
    diagnostico: ["responsavel","admin"],
    orcamento:   ["operador","responsavel","admin"], // aprovação do cliente
    manutencao:  ["responsavel","admin"],
    finalizado:  ["operador","responsavel","admin"], // entrega ao cliente
  };
  const isOpen = o => o.estado!=="entregue" && o.estado!=="cancelada"; // assistência em curso

  // contas iniciais (geridas pelo administrador na página Contas)
  const DEFAULT_USERS = [
    {nome:"Administrador",       user:"admin",     pass:"admin", role:"admin",       loja:null},
    {nome:"Utilizador Recoshop", user:"recoshop",  pass:"123",   role:"operador",    loja:"Recoshop"},
    {nome:"Utilizador G.S.",     user:"gscenter",  pass:"123",   role:"operador",    loja:"G.S.Center"},
    {nome:"Utilizador LifeTech", user:"lifetech",  pass:"123",   role:"operador",    loja:"LifeTech"},
    {nome:"Responsável Técnico", user:"responsavel",pass:"123",  role:"responsavel", loja:null},
  ];

  let db = null;        // {ordens, clientes, ..., utilizadores}
  let session = null;   // current user object
  let prevNotif = null; // última contagem de notificações (para animar quando aumenta)
  let agendaWeek = null; // segunda-feira da semana mostrada na agenda
  let currentDetailId = null; // OS aberta na ficha (para atualizar em tempo real)

  // ---------- persistence ----------
  function ensureShape(){
    if(!db.utilizadores) db.utilizadores = JSON.parse(JSON.stringify(DEFAULT_USERS));
    if(!Array.isArray(db.lojas) || !db.lojas.length) db.lojas = JSON.parse(JSON.stringify(window.SEED.lojas));
    ["clientes","localizacoes","dispositivos","marcas","tecnicos","ordens"].forEach(k=>{ if(!Array.isArray(db[k])) db[k]=[]; });
  }
  function load(){
    const saved = localStorage.getItem(KEY);
    db = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(window.SEED));
    ensureShape();
    persistLocal();
  }
  // adiciona um valor à lista (sem duplicar) — os catálogos crescem à medida que se usa
  function pushUnique(arr, val){
    if(val && !arr.some(x=>String(x).toLowerCase()===String(val).toLowerCase())){ arr.push(val); arr.sort((a,b)=>String(a).localeCompare(b)); return true; }
    return false;
  }
  function persistLocal(){ localStorage.setItem(KEY, JSON.stringify(db)); }
  function save(){ persistLocal(); cloudPushDebounced(); }
  function resetData(){ localStorage.removeItem(KEY); load(); save(); }

  // ---------- sincronização na nuvem (Supabase) — opcional ----------
  const CFG = window.TECNOASSIST_CONFIG || {};
  const cloudEnabled = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  let supa = null, cloudTimer = null, applyingRemote = false;
  function cloudPushDebounced(){ if(!cloudEnabled) return; clearTimeout(cloudTimer); cloudTimer = setTimeout(cloudPush, 300); }
  async function cloudPush(){
    if(!supa || applyingRemote) return;
    try{ await supa.from("tecnoassist_state").upsert({ id:1, data:db, updated_at:new Date().toISOString() }); }
    catch(e){ console.warn("TecnoAssist: falha ao guardar na nuvem", e); }
  }
  function applyRemote(remote){
    if(!remote || typeof remote!=="object" || !Object.keys(remote).length) return;
    applyingRemote = true; db = remote; ensureShape(); persistLocal(); applyingRemote = false;
    refreshUI();
  }
  async function cloudStart(){
    if(!cloudEnabled) return;
    try{
      const m = await import("https://esm.sh/@supabase/supabase-js@2");
      supa = m.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
      const { data, error } = await supa.from("tecnoassist_state").select("data").eq("id",1).maybeSingle();
      if(error) throw error;
      if(data && data.data && Object.keys(data.data).length) applyRemote(data.data);
      else await cloudPush(); // primeira vez: envia o estado atual
      supa.channel("tecnoassist")
        .on("postgres_changes", {event:"*", schema:"public", table:"tecnoassist_state", filter:"id=eq.1"},
            p => applyRemote(p.new && p.new.data))
        .subscribe();
      setCloudMode(true);
    }catch(e){ console.warn("TecnoAssist: nuvem indisponível, a usar modo local.", e); setCloudMode(false); }
  }
  function setCloudMode(on){ const el=$("#cloud-mode"); if(el) el.textContent = on ? "Sincronizado · nuvem" : "Modo local · este dispositivo"; }
  function renderActive(){
    const active = document.querySelector(".page.active");
    const p = active ? active.id.replace("page-","") : "dashboard";
    if(p==="dashboard") renderDashboard();
    else if(p==="ordens") renderTable();
    else if(p==="clientes") renderClientes();
    else if(p==="tecnicos") renderTecnicos();
    else if(p==="agenda") renderAgenda();
    else if(p==="utilizadores") renderUsers();
  }
  function refreshUI(){
    if(!session) return;
    renderActive();        // atualiza a lista/dashboard por baixo
    updateNotif();
    // se a ficha de uma OS está aberta, atualiza o estado em tempo real —
    // mas não interrompe quem está a escrever num campo do modal
    const mr = $("#modal-root");
    const modalOpen = mr && (mr.innerHTML||"").trim()!=="";
    if(modalOpen && currentDetailId){
      const ae = document.activeElement;
      const typing = mr.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName||"");
      if(!typing && db.ordens.some(o=>o.id===currentDetailId)) openDetail(currentDetailId);
    }
  }
  function factoryReset(){
    if(!session || session.role!=="admin"){ alert("Só o administrador pode repor o sistema."); return; }
    if(!confirm("Repor o sistema?\n\nIsto APAGA todas as assistências, clientes, técnicos e catálogos inseridos.\nAs contas de acesso e as lojas mantêm-se.\n\nEsta ação não pode ser anulada.")) return;
    resetData();
    prevNotif = null; agendaWeek = null;
    closeModal();
    buildMonthFilter();
    go("dashboard");
    alert("Sistema reposto. Podes começar a registar de novo.");
  }

  // ---------- helpers ----------
  const $ = s => document.querySelector(s);
  const esc = s => (s==null?"":String(s)).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const money = n => (Number(n)||0).toLocaleString("pt-PT") + "$";
  const lojaNome = id => (window.SEED.lojas.find(l=>l.id===id)||{}).nome || id || "—";
  const nextId = () => "AS-" + String(db.ordens.reduce((m,o)=>Math.max(m, parseInt((o.id.split("-")[1]||"0"),10)),0)+1).padStart(4,"0");
  const monthOf = o => (o.entrada||"").slice(0,7);  // YYYY-MM

  // o responsável técnico e o admin veem todas as lojas; o utilizador vê só a sua
  const seesAllStores = () => session.role==="admin" || session.role==="responsavel";
  function scoped(){
    if(!session) return [];
    if(seesAllStores()) return db.ordens;
    return db.ordens.filter(o => o.loja === session.store);
  }
  const can = action => {
    const r = session.role;
    if(r==="admin") return true;
    if(action==="createOrder")  return r==="operador" || r==="responsavel"; // utilizador e responsável registam
    if(action==="manageOrder")  return r==="responsavel";       // atribui técnico, prioridade, taxa, conserto
    if(action==="manageUsers")  return false;
    return false;
  };

  // ---------- login ----------
  function login(){
    const u = $("#login-user").value.trim();
    const p = $("#login-pass").value;
    const acc = db.utilizadores.find(x=>x.user.toLowerCase()===u.toLowerCase() && x.pass===p);
    if(!acc){ $("#login-error").classList.remove("hidden"); return; }
    $("#login-error").classList.add("hidden");
    session = {nome:acc.nome, role:acc.role, store:acc.loja, user:acc.user};
    localStorage.setItem(SKEY, acc.user);
    $("#login-pass").value="";
    $("#login").classList.add("hidden");
    $("#app").classList.add("active");
    boot();
  }
  function logout(){
    session = null;
    prevNotif = null;
    localStorage.removeItem(SKEY);
    localStorage.removeItem(PKEY);
    document.body.classList.remove("role-admin");
    $("#account").classList.remove("open");
    $("#app").classList.remove("active");
    $("#login").classList.remove("hidden");
  }
  // repõe a sessão após um refresh, mantendo a página onde estava
  function restoreSession(){
    const u = localStorage.getItem(SKEY);
    if(!u) return;
    const acc = (db.utilizadores||[]).find(x=>x.user===u);
    if(!acc){ localStorage.removeItem(SKEY); return; }
    session = {nome:acc.nome, role:acc.role, store:acc.loja, user:acc.user};
    $("#login").classList.add("hidden");
    $("#app").classList.add("active");
    boot(localStorage.getItem(PKEY) || "dashboard");
  }

  function toggleTheme(){
    setTheme(document.body.classList.contains("dark") ? "light" : "dark");
  }
  function setTheme(mode){
    document.body.classList.toggle("dark", mode==="dark");
    localStorage.setItem("tecnoassist_theme", mode);
  }
  function applyTheme(){
    if(localStorage.getItem("tecnoassist_theme")==="dark") document.body.classList.add("dark");
  }

  function toggleAccount(e){
    e.stopPropagation();
    const acc = $("#account");
    acc.classList.toggle("open");
    if(acc.classList.contains("open")){
      document.addEventListener("click", closeAccountOnce);
    }
  }
  function closeAccountOnce(e){
    const acc = $("#account");
    if(acc && !acc.contains(e.target)){
      acc.classList.remove("open");
      document.removeEventListener("click", closeAccountOnce);
    }
  }
  function navFromMenu(page){
    $("#account").classList.remove("open");
    document.removeEventListener("click", closeAccountOnce);
    go(page);
  }

  // ---------- boot after login ----------
  function boot(target){
    document.body.classList.toggle("role-admin", session.role==="admin");
    const sub = ROLE_LABEL[session.role] + " · " + (seesAllStores() ? "Todas as lojas" : lojaNome(session.store));
    $("#acc-name").textContent = session.nome;
    $("#acc-sub").textContent = sub;
    $("#acc-menu-name").textContent = session.nome;
    $("#acc-menu-sub").textContent = sub;
    $("#avatar").textContent = (session.nome||"U")[0].toUpperCase();
    setCloudMode(cloudEnabled ? !!supa : false);
    if(cloudEnabled && !supa) $("#cloud-mode").textContent = "A ligar à nuvem…";
    const h = new Date().getHours();
    $("#greeting").textContent = (h<12?"Bom dia":h<19?"Boa tarde":"Boa noite") + ", " + session.nome;

    // visibilidade por perfil (via .hidden p/ não colidir com a responsividade CSS)
    const tog=(sel,show)=>document.querySelectorAll(sel).forEach(e=>e.classList.toggle("hidden", !show));
    tog(".new-os-btn", can("createOrder"));
    tog(".cli-add", canManageClients());
    tog(".tec-add", canManageTecnicos());
    tog(".tec-nav", canManageTecnicos());
    tog(".agenda-nav", canManageTecnicos());
    tog(".admin-only", session.role==="admin");
    agendaWeek = null;
    updateNotif();

    // loja filter (quem vê todas as lojas)
    const fl = $("#filter-loja");
    if(seesAllStores()){
      fl.style.display="";
      fl.innerHTML = `<option value="">Todas as lojas</option>` + window.SEED.lojas.map(l=>`<option value="${l.id}">${esc(l.nome)}</option>`).join("");
    } else { fl.style.display="none"; fl.value=""; }

    buildMonthFilter();
    go(target || "dashboard");
  }

  function buildMonthFilter(){
    const meses = [...new Set(scoped().map(monthOf).filter(Boolean))].sort().reverse();
    const cur = new Date().toISOString().slice(0,7);
    if(!meses.includes(cur)) meses.unshift(cur);
    $("#filter-mes").innerHTML = `<option value="">Todos os meses</option>` +
      meses.map(m=>`<option value="${m}">${mesLabel(m)}</option>`).join("");
  }
  function mesLabel(m){
    const nomes=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    const [y,mm]=m.split("-"); return `${nomes[(+mm)-1]||mm}/${y}`;
  }

  // ---------- navigation ----------
  function go(page){
    if(page==="utilizadores" && session.role!=="admin") page="dashboard";
    if(page==="agenda" && !canManageTecnicos()) page="dashboard";
    localStorage.setItem(PKEY, page);
    document.querySelectorAll(".nav button, .tabbar button, .rail-nav .rail-btn").forEach(b=>b.classList.toggle("active", b.dataset.page===page));
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    $("#page-"+page).classList.add("active");
    if(page==="dashboard") renderDashboard();
    if(page==="ordens") renderTable();
    if(page==="clientes") renderClientes();
    if(page==="tecnicos") renderTecnicos();
    if(page==="agenda") renderAgenda();
    if(page==="utilizadores") renderUsers();
    updateNotif();
  }
  const canManageClients = () => can("createOrder");
  const canManageTecnicos = () => session.role==="admin" || session.role==="responsavel";
  const jsStr = s => String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'");

  // ---------- dashboard ----------
  const MES_ABBR=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const monthLabel = ym => { const [y,m]=ym.split("-"); return MES_ABBR[(+m)-1]+" "+y; };
  const shortStore = n => n.replace(/,?\s*Lda\.?$/i,"").trim();
  const STAGE_COLOR = {registado:"var(--orange)",diagnostico:"var(--amber)",orcamento:"var(--blue)",manutencao:"var(--purple)",finalizado:"var(--slate)",entregue:"var(--green)",cancelada:"#dc2626"};
  const SVG = s => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s}</svg>`;
  const KPI_ICON = {
    abertas:   SVG('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="13" y2="13"/>'),
    reparacao: SVG('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4z"/>'),
    entregues: SVG('<rect x="3" y="6" width="11" height="9" rx="1.5"/><path d="M14 9h3.5L21 12v3h-7z"/><circle cx="7" cy="18" r="1.7"/><circle cx="17.5" cy="18" r="1.7"/>'),
    aguardar:  SVG('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/>')
  };

  function renderDashboard(){
    const list = scoped();
    const count = e => list.filter(o=>o.estado===e).length;
    const abertas = list.filter(isOpen).length;
    const entregues = list.filter(o=>o.estado==="entregue");
    const fatur = entregues.reduce((s,o)=>s+(Number(o.preco)||0),0);

    // --- HERO: faturação + lojas ---
    const curMonth = new Date().toISOString().slice(0,7);
    const mesFatur = entregues.filter(o=>monthOf(o)===curMonth).reduce((s,o)=>s+(Number(o.preco)||0),0);
    $("#hero-fatur").textContent = money(fatur);
    $("#hero-mes").textContent = monthLabel(curMonth);
    $("#hero-trend").innerHTML = `<span class="up">&#9650; ${money(mesFatur)}</span> faturado este mês`;
    const lojas = seesAllStores() ? window.SEED.lojas : window.SEED.lojas.filter(l=>l.id===session.store);
    $("#hero-lojas-label").textContent = seesAllStores() ? `Lojas · ${lojas.length}` : "A sua loja";
    $("#hero-stores").innerHTML = lojas.map(l=>{
      const n = db.ordens.filter(o=>o.loja===l.id).length;
      const ab = db.ordens.filter(o=>o.loja===l.id && isOpen(o)).length;
      return `<div class="hw-card">
        <div class="hw-name">${esc(shortStore(l.nome))}</div>
        <div class="hw-num">${n} assist.</div>
        <div class="hw-status ${ab?'on':'off'}">${ab? ab+" ativas":"Sem ativas"}</div>
      </div>`;
    }).join("");

    // --- 2x2 metrics ---
    $("#kpis").innerHTML = `
      ${kpi("Assistências abertas", abertas, "em curso", true, KPI_ICON.abertas)}
      ${kpi("Em manutenção", count("manutencao"), "reparo/peças", false, KPI_ICON.reparacao)}
      ${kpi("Aguardam retirada", count("finalizado"), "prontas", false, KPI_ICON.aguardar)}
      ${kpi("Entregues", count("entregue"), "no histórico", false, KPI_ICON.entregues)}
    `;

    // --- month bars (entregues vs em curso) ---
    renderMonthBars(list);

    // --- pipeline as flow list ---
    const stages = [...ESTADOS, "cancelada"];
    const maxStage = Math.max(1, ...stages.map(count));
    $("#pipeline").innerHTML = stages.map(e=>`
      <div class="flow-row" title="${ESTADO_HINT[e]||""}">
        <span class="fl-name">${ESTADO_LABEL[e]}</span>
        <span class="fl-bar"><i style="width:${Math.round(count(e)/maxStage*100)}%;background:${STAGE_COLOR[e]}"></i></span>
        <span class="fl-count">${count(e)}</span>
      </div>`).join("");

    // --- top devices ---
    const dev = tally(list, o=>o.dispositivo);
    $("#top-devices").innerHTML = topN(dev,5).map(([k,v])=>row(k,v)).join("") || emptyRow();

    // --- recent ---
    const recent = [...list].reverse().slice(0,6);
    $("#recent-body").innerHTML = recent.map(o=>`
      <tr onclick="App.openDetail('${o.id}')">
        <td class="os-id" data-label="Nº">${o.id}</td>
        <td data-label="Cliente">${esc(o.cliente)}</td>
        <td data-label="Equipamento">${esc(devLabel(o))||"—"}</td>
        <td data-label="Estado">${badge(o.estado)}</td>
        <td data-label="Técnico">${esc(o.tecnico||"—")}</td>
        <td style="text-align:right" data-label="Preço">${money(o.preco)}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty">Sem assistências.</td></tr>`;
  }

  function renderMonthBars(list){
    const now = new Date();
    const months=[];
    for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(), now.getMonth()-i, 1); months.push(d.toISOString().slice(0,7)); }
    const data = months.map(ym=>{
      const inM = list.filter(o=>monthOf(o)===ym);
      return { ym, ent: inM.filter(o=>o.estado==="entregue").length, ab: inM.filter(isOpen).length };
    });
    const max = Math.max(1, ...data.map(d=>Math.max(d.ent,d.ab)));
    $("#month-bars").innerHTML = data.map(d=>`
      <div class="bar-col" title="${monthLabel(d.ym)} — entregues: ${d.ent}, em curso: ${d.ab}">
        <div class="bar-track bar-pair">
          <div class="bar" style="height:${Math.round(d.ent/max*100)}%"></div>
          <div class="bar alt" style="height:${Math.round(d.ab/max*100)}%"></div>
        </div>
        <div class="bar-lbl">${MES_ABBR[(+d.ym.split("-")[1])-1]}</div>
      </div>`).join("");
  }
  const kpi=(l,v,h,accent,ico)=>`<div class="kpi ${accent?'accent':''}"><div class="kpi-top"><span class="label">${l}</span><span class="kpi-ico">${ico||""}</span></div><div class="value">${v}</div><div class="hint">${h}</div></div>`;
  const row=(k,v)=>`<div class="mini-row"><span>${esc(k)}</span><span class="m-val">${v}</span></div>`;
  const emptyRow=()=>`<div class="empty">Sem dados.</div>`;
  function tally(arr,fn){const m={};arr.forEach(o=>{const k=fn(o);if(k)m[k]=(m[k]||0)+1;});return m;}
  function topN(obj,n){return Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n);}
  function devLabel(o){return [o.dispositivo,o.marca].filter(Boolean).join(" ");}
  function badge(e){return `<span class="badge b-${e}">${ESTADO_LABEL[e]}</span>`;}

  // ---------- orders table ----------
  function currentFilter(){
    let list = scoped();
    const q = ($("#search").value||"").toLowerCase().trim();
    const fm = $("#filter-mes").value;
    const fe = $("#filter-estado").value;
    const flv = $("#filter-loja").value;
    if(fm) list = list.filter(o=>monthOf(o)===fm);
    if(fe) list = list.filter(o=>o.estado===fe);
    if(flv) list = list.filter(o=>o.loja===flv);
    if(q) list = list.filter(o=>[o.id,o.cliente,o.dispositivo,o.marca,o.avaria,o.tecnico,o.localizacao].some(v=>v&&String(v).toLowerCase().includes(q)));
    return list;
  }
  function renderTable(){
    const list = [...currentFilter()].reverse();
    $("#orders-empty").classList.toggle("hidden", list.length>0);
    $("#orders-body").innerHTML = list.map(o=>`
      <tr onclick="App.openDetail('${o.id}')">
        <td class="os-id" style="padding-left:20px" data-label="Nº">${o.id}</td>
        <td data-label="Cliente">${esc(o.cliente)}</td>
        <td data-label="Equipamento">${esc(devLabel(o))||"—"}</td>
        <td data-label="Estado">${badge(o.estado)}</td>
        <td data-label="Técnico">${esc(o.tecnico||"—")}</td>
        <td data-label="Loja">${esc(lojaNome(o.loja))}</td>
        <td data-label="Entrada">${esc(o.entrada||"—")}</td>
        <td style="padding-right:20px" data-label="Preço">${money(o.preco)}</td>
      </tr>`).join("");
  }

  // ---------- export ----------
  function exportMonth(){
    const list = currentFilter();
    if(!list.length){ alert("Não há assistências para exportar com os filtros atuais."); return; }
    const cols = [
      ["Entidade","cliente"],["Morada","morada"],["Localizacao","localizacao"],["Dispositivos","dispositivo"],
      ["Marca / Modelo","marca"],["Qty","qty"],["Serial Number","serial"],
      ["Prioridade",o=>o.prioridade==="urgente"?"Urgente":"Normal"],
      ["Estado",o=>ESTADO_LABEL[o.estado]],["Descricao de Avaria","avaria"],["Entrada","entrada"],
      ["Agendamento","agenda"],["Taxa","taxa"],["Preco","preco"],["Descricao de Conserto","conserto"],
      ["Saida","saida"],["Tecnico","tecnico"],["Loja",o=>lojaNome(o.loja)],["Assistencia","id"]
    ];
    const cell = v => `"${String(v==null?"":v).replace(/"/g,'""')}"`;
    const head = cols.map(c=>cell(c[0])).join(";");
    const body = list.map(o=>cols.map(c=>cell(typeof c[1]==="function"?c[1](o):o[c[1]])).join(";")).join("\r\n");
    const csv = "﻿" + head + "\r\n" + body;   // BOM => Excel abre com acentos
    const mes = $("#filter-mes").value || "todos";
    const loja = session.role==="admin" ? ($("#filter-loja").value||"todas") : session.store;
    download(`Assistencias_${loja}_${mes}.csv`, csv);
  }
  function download(name, text){
    const blob = new Blob([text], {type:"text/csv;charset=utf-8;"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- modals ----------
  function closeModal(){ $("#modal-root").innerHTML=""; currentDetailId = null; }
  function opt(arr,sel){return arr.map(v=>`<option ${v===sel?"selected":""}>${esc(v)}</option>`).join("");}

  function openNew(){
    if(!can("createOrder")){ alert("O teu perfil não regista assistências."); return; }
    currentDetailId = null;
    const lojas = seesAllStores() ? window.SEED.lojas : window.SEED.lojas.filter(l=>l.id===session.store);
    $("#modal-root").innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <button class="modal-close" onclick="App.closeModal()">&times;</button>
        <h3>Nova assistência</h3>
        <p class="sub">Registo dos dados recebidos do cliente. A atribuição do técnico e o valor ficam para o responsável técnico.</p>
        <div class="form-grid">
          <div><label>Loja</label><select id="f-loja" ${lojas.length===1?"disabled":""}>${lojas.map(l=>`<option value="${l.id}">${esc(l.nome)}</option>`).join("")}</select></div>
          <div><label>Cliente (nome)</label><input id="f-cliente" list="dl-clientes" placeholder="Nome do cliente"><datalist id="dl-clientes">${db.clientes.map(c=>`<option value="${esc(c)}">`).join("")}</datalist></div>
          <div class="full"><label>Morada</label><input id="f-morada" placeholder="Morada / contacto do cliente"></div>
          <div><label>Equipamento</label><input id="f-disp" list="dl-disp" placeholder="Ex.: Impressora"><datalist id="dl-disp">${db.dispositivos.map(d=>`<option value="${esc(d)}">`).join("")}</datalist></div>
          <div><label>Marca / Modelo</label><input id="f-marca" list="dl-marca" placeholder="Ex.: HP"><datalist id="dl-marca">${db.marcas.map(m=>`<option value="${esc(m)}">`).join("")}</datalist></div>
          <div><label>Quantidade</label><input id="f-qty" type="number" min="1" value="1"></div>
          <div><label>Nº de série</label><input id="f-serial" placeholder="Opcional"></div>
          <div class="full"><label>Descrição da avaria</label><textarea id="f-avaria" placeholder="Problema relatado pelo cliente"></textarea></div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" onclick="App.closeModal()">Cancelar</button>
          <button class="btn primary" onclick="App.createOrder()">Registar assistência</button>
        </div>
      </div>
    </div>`;
  }

  function createOrder(){
    const cliente = $("#f-cliente").value.trim();
    if(!cliente){ alert("Indica o cliente."); return; }
    const loja = seesAllStores() ? $("#f-loja").value : session.store;
    const o = {
      id: nextId(), loja, cliente,
      morada: $("#f-morada").value.trim()||null,
      localizacao: null,
      dispositivo: $("#f-disp").value.trim()||null,
      marca: $("#f-marca").value.trim()||null,
      qty: Number($("#f-qty").value)||1,
      serial: $("#f-serial").value.trim()||null,
      avaria: $("#f-avaria").value.trim()||null,
      entrada: new Date().toISOString().slice(0,10),
      taxa: 0, prioridade:"normal", agenda:null,
      preco: 0, conserto:null, saida:null, tecnico:null,
      estado:"registado"
    };
    // catálogos crescem com o uso
    pushUnique(db.clientes, cliente);
    pushUnique(db.dispositivos, o.dispositivo);
    pushUnique(db.marcas, o.marca);
    db.ordens.push(o); save();
    buildMonthFilter(); renderTable(); updateNotif();
    openDetail(o.id);
  }

  function openDetail(id){
    const o = db.ordens.find(x=>x.id===id); if(!o) return;
    currentDetailId = id;
    const idx = ESTADOS.indexOf(o.estado);
    const cancelada = o.estado==="cancelada";
    const terminal = o.estado==="entregue" || cancelada;
    const flow = cancelada
      ? `<div class="flow-step current" style="flex:1;background:#fde4e4;color:#dc2626">Serviço cancelado</div>`
      : FLOW.map((s,i)=>`<div class="flow-step ${i<idx?'done':i===idx?'current':''}">${s.label}</div>`).join('<span style="color:#bbb">&rsaquo;</span>');
    const mayAdvance = !terminal && (ADVANCE_PERM[o.estado]||[]).includes(session.role);
    const nextLabel = (!terminal && idx<ESTADOS.length-1) ? FLOW[idx+1].label : null;
    const canManage = can("manageOrder");   // responsável (admin pode tudo)
    const canCancel = !terminal && canManage; // só responsável/admin podem cancelar
    const prio = o.prioridade||"normal";

    $("#modal-root").innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <button class="modal-close" onclick="App.closeModal()">&times;</button>
        <h3>${o.id} &nbsp; ${badge(o.estado)} ${prio==="urgente"&&!terminal?'<span class="badge b-urgente">Urgente</span>':''}</h3>
        <p class="sub">${esc(o.cliente)} · ${esc(lojaNome(o.loja))}</p>
        <div class="flow-track">${flow}</div>
        ${detRow("Morada", o.morada||"—")}
        ${detRow("Equipamento", devLabel(o)||"—")}
        ${detRow("Quantidade", o.qty)}
        ${detRow("Nº de série", o.serial||"—")}
        ${detRow("Avaria", o.avaria||"—")}
        ${detRow("Conserto", o.conserto||"—")}
        ${detRow("Técnico", o.tecnico||"— (por atribuir)")}
        ${detRow("Agendamento", o.agenda||"—")}
        ${detRow("Entrada", o.entrada||"—")}
        ${detRow("Saída", o.saida||"—")}
        ${detRow("Taxa de diagnóstico", money(o.taxa))}
        ${detRow("Preço", money(o.preco))}

        <div style="margin-top:20px;border-top:1px solid var(--line);padding-top:18px">
          ${canManage ? `
          <div class="form-grid">
            <div><label>Prioridade</label>
              <select id="d-prioridade" onchange="document.getElementById('d-taxa').value = this.value==='urgente'?${TAXA_PRIORIDADE.urgente}:${TAXA_PRIORIDADE.normal}">
                <option value="normal" ${prio==="normal"?"selected":""}>Normal</option>
                <option value="urgente" ${prio==="urgente"?"selected":""}>Urgente</option>
              </select></div>
            <div><label>Taxa de diagnóstico (CVE)</label><input id="d-taxa" type="number" min="0" value="${Number(o.taxa)||0}"></div>
            <div><label>Atribuir técnico</label><input id="d-tecnico" list="dl-tec" value="${esc(o.tecnico||"")}" placeholder="Nome do técnico"><datalist id="dl-tec">${db.tecnicos.map(t=>`<option value="${esc(t)}">`).join("")}</datalist></div>
            <div><label>Agendamento</label><input id="d-agenda" type="date" value="${o.agenda||""}"></div>
            <div class="full"><label>Descrição da avaria</label><textarea id="d-avaria">${esc(o.avaria||"")}</textarea></div>
            <div class="full"><label>Descrição do conserto</label><textarea id="d-conserto">${esc(o.conserto||"")}</textarea></div>
            <div><label>Preço final (CVE)</label><input id="d-preco" type="number" min="0" value="${Number(o.preco)||0}"></div>
          </div>` : `<p class="sub" style="margin:0 0 4px">${o.estado==="finalizado"?"Disponível para retirada pelo cliente.":"A gestão técnica é feita pelo responsável técnico."}</p>`}
          <div class="modal-actions">
            ${canCancel?`<button class="btn danger" style="margin-right:auto" onclick="App.cancelOrder('${o.id}')">Cancelar serviço</button>`:""}
            ${canManage&&!terminal?`<button class="btn ghost" onclick="App.saveDetail('${o.id}')">Guardar alterações</button>`:""}
            ${o.estado==="entregue"
              ? `<span style="color:var(--green);font-weight:600;align-self:center">&#10003; Entregue ao cliente</span>`
              : cancelada
                ? `<span style="color:#dc2626;font-weight:600;align-self:center">&#10005; Serviço cancelado</span>`
              : mayAdvance
                ? `<button class="btn primary" onclick="App.advance('${o.id}')">Avançar &rarr; ${nextLabel}</button>`
                : `<span style="color:var(--muted);align-self:center;font-size:13px">Aguarda ação de: ${(ADVANCE_PERM[o.estado]||[]).map(r=>ROLE_LABEL[r]).filter(x=>x!=="Administrador").join(" / ")}</span>`}
          </div>
        </div>
      </div>
    </div>`;
  }
  const detRow=(l,v)=>`<div class="detail-row"><span class="d-lbl">${l}</span><span class="d-val">${esc(v)}</span></div>`;

  function pullEdits(o){
    if(!can("manageOrder")) return;
    if($("#d-prioridade")) o.prioridade = $("#d-prioridade").value;
    if($("#d-taxa")) o.taxa = Number($("#d-taxa").value)||0;
    if($("#d-tecnico")){ o.tecnico = $("#d-tecnico").value.trim()||null; pushUnique(db.tecnicos, o.tecnico); }
    if($("#d-agenda")) o.agenda = $("#d-agenda").value||null;
    if($("#d-avaria")) o.avaria = $("#d-avaria").value.trim()||null;
    if($("#d-conserto")) o.conserto = $("#d-conserto").value.trim()||null;
    if($("#d-preco")) o.preco = Number($("#d-preco").value)||0;
  }
  function saveDetail(id){
    const o = db.ordens.find(x=>x.id===id); if(!o) return;
    pullEdits(o); save(); openDetail(id); renderTable(); updateNotif();
  }
  function advance(id){
    const o = db.ordens.find(x=>x.id===id); if(!o) return;
    const idx = ESTADOS.indexOf(o.estado);
    if(idx>=ESTADOS.length-1) return;
    if(!(ADVANCE_PERM[o.estado]||[]).includes(session.role)){ alert("O teu perfil não pode avançar este estágio."); return; }
    pullEdits(o);
    o.estado = ESTADOS[idx+1];
    if(o.estado==="entregue" && !o.saida) o.saida = new Date().toISOString().slice(0,10);
    save(); openDetail(id); renderTable(); updateNotif();
  }
  function cancelOrder(id){
    if(!can("manageOrder")){ alert("Só o responsável técnico ou o administrador podem cancelar."); return; }
    const o = db.ordens.find(x=>x.id===id); if(!o) return;
    if(o.estado==="entregue" || o.estado==="cancelada") return;
    if(!confirm(`Cancelar a assistência ${o.id} (${o.cliente})?\nO serviço será marcado como não realizado.`)) return;
    pullEdits(o);
    o.estado = "cancelada"; o.saida = new Date().toISOString().slice(0,10);
    save(); openDetail(id); renderTable(); updateNotif();
  }

  // ---------- clientes ----------
  function renderClientes(){
    const q = ($("#cli-search").value||"").toLowerCase().trim();
    const map = {};
    scoped().forEach(o=>{
      const k=o.cliente; if(!k) return;
      if(!map[k]) map[k]={nome:k,total:0,abertas:0,locs:new Set(),last:""};
      map[k].total++; if(isOpen(o)) map[k].abertas++;
      if(o.localizacao) map[k].locs.add(o.localizacao);
      if(o.entrada && o.entrada>map[k].last) map[k].last=o.entrada;
    });
    if(seesAllStores()) (db.clientes||[]).forEach(c=>{ if(!map[c]) map[c]={nome:c,total:0,abertas:0,locs:new Set(),last:""}; });
    let rows = Object.values(map);
    if(q) rows = rows.filter(r=>r.nome.toLowerCase().includes(q));
    rows.sort((a,b)=> b.total-a.total || a.nome.localeCompare(b.nome));
    $("#clients-empty").classList.toggle("hidden", rows.length>0);
    const canDel = canManageClients();
    $("#clients-body").innerHTML = rows.map(r=>`
      <tr onclick="App.clienteOrders('${jsStr(r.nome)}')">
        <td style="padding-left:20px;font-weight:500" data-label="Cliente">${esc(r.nome)}</td>
        <td data-label="Assistências">${r.total}</td>
        <td data-label="Em curso">${r.abertas? `<span class="badge b-reparacao">${r.abertas}</span>`:"—"}</td>
        <td data-label="Localização">${[...r.locs].slice(0,2).map(esc).join(", ")||"—"}</td>
        <td data-label="Última entrada">${esc(r.last||"—")}</td>
        <td style="padding-right:20px;text-align:right" data-label="" onclick="event.stopPropagation()">
          ${(canDel && r.total===0)?`<button class="link-btn danger" onclick="App.delClient('${jsStr(r.nome)}')">Remover</button>`:""}
        </td>
      </tr>`).join("");
  }
  function clienteOrders(nome){ go("ordens"); $("#search").value=nome; if($("#filter-mes"))$("#filter-mes").value=""; renderTable(); }
  function openClient(){
    if(!canManageClients()){ alert("O teu perfil não adiciona clientes."); return; }
    currentDetailId = null;
    $("#modal-root").innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-width:440px">
        <button class="modal-close" onclick="App.closeModal()">&times;</button>
        <h3>Novo cliente</h3>
        <p class="sub">Adiciona uma entidade ao registo de clientes.</p>
        <div class="form-grid"><div class="full"><label>Nome do cliente</label><input id="c-nome" placeholder="Ex.: Hotel VIP" onkeydown="if(event.key==='Enter')App.saveClient()"></div></div>
        <div class="modal-actions">
          <button class="btn ghost" onclick="App.closeModal()">Cancelar</button>
          <button class="btn primary" onclick="App.saveClient()">Adicionar</button>
        </div>
      </div></div>`;
    setTimeout(()=>$("#c-nome").focus(),50);
  }
  function saveClient(){
    const nome=$("#c-nome").value.trim(); if(!nome){ alert("Indica o nome."); return; }
    if(!db.clientes) db.clientes=[];
    if(db.clientes.some(c=>c.toLowerCase()===nome.toLowerCase())){ alert("Esse cliente já existe."); return; }
    db.clientes.push(nome); db.clientes.sort((a,b)=>a.localeCompare(b)); save(); closeModal(); renderClientes();
  }
  function delClient(nome){
    if(db.ordens.some(o=>o.cliente===nome)){ alert("Não dá para remover: este cliente tem assistências registadas."); return; }
    if(!confirm(`Remover o cliente "${nome}"?`)) return;
    db.clientes = (db.clientes||[]).filter(c=>c!==nome); save(); renderClientes();
  }

  // ---------- técnicos ----------
  function renderTecnicos(){
    const q = ($("#tec-search").value||"").toLowerCase().trim();
    const map = {};
    scoped().forEach(o=>{
      const k=o.tecnico; if(!k) return;
      if(!map[k]) map[k]={nome:k,total:0,abertas:0,entregues:0,fatur:0};
      map[k].total++;
      if(o.estado==="entregue"){ map[k].entregues++; map[k].fatur+=Number(o.preco)||0; } else if(isOpen(o)) map[k].abertas++;
    });
    if(canManageTecnicos()) (db.tecnicos||[]).forEach(t=>{ if(!map[t]) map[t]={nome:t,total:0,abertas:0,entregues:0,fatur:0}; });
    let rows = Object.values(map);
    if(q) rows = rows.filter(r=>r.nome.toLowerCase().includes(q));
    rows.sort((a,b)=> b.total-a.total || a.nome.localeCompare(b.nome));
    $("#tecs-empty").classList.toggle("hidden", rows.length>0);
    const canMng = canManageTecnicos();
    $("#tecs-body").innerHTML = rows.map(r=>`
      <tr onclick="App.tecnicoOrders('${jsStr(r.nome)}')">
        <td style="padding-left:20px;font-weight:500" data-label="Técnico">${esc(r.nome)}</td>
        <td data-label="Atribuídas">${r.total}</td>
        <td data-label="Em curso">${r.abertas||"—"}</td>
        <td data-label="Entregues">${r.entregues||"—"}</td>
        <td data-label="Faturação">${money(r.fatur)}</td>
        <td style="padding-right:20px;text-align:right;white-space:nowrap" data-label="" onclick="event.stopPropagation()">
          ${canMng?`<button class="link-btn" onclick="App.openTecnico('${jsStr(r.nome)}')">Editar</button>`:""}
          ${(canMng && r.total===0)?`<button class="link-btn danger" onclick="App.delTecnico('${jsStr(r.nome)}')">Remover</button>`:""}
        </td>
      </tr>`).join("");
  }
  function tecnicoOrders(nome){ go("ordens"); $("#search").value=nome; if($("#filter-mes"))$("#filter-mes").value=""; renderTable(); }
  function openTecnico(name){
    if(!canManageTecnicos()){ alert("Só o responsável técnico ou o administrador gerem técnicos."); return; }
    currentDetailId = null;
    const editing = name!=null;
    $("#modal-root").innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)App.closeModal()">
      <div class="modal" style="max-width:440px">
        <button class="modal-close" onclick="App.closeModal()">&times;</button>
        <h3>${editing?"Editar técnico":"Novo técnico"}</h3>
        <p class="sub">${editing?"Alterar o nome atualiza também as assistências deste técnico.":"Adiciona um técnico à equipa (fica disponível para atribuição nas assistências)."}</p>
        <div class="form-grid"><div class="full"><label>Nome do técnico</label><input id="t-nome" value="${editing?esc(name):""}" placeholder="Ex.: João Silva" onkeydown="if(event.key==='Enter')App.saveTecnico(${editing?`'${jsStr(name)}'`:"null"})"></div></div>
        <div class="modal-actions">
          <button class="btn ghost" onclick="App.closeModal()">Cancelar</button>
          <button class="btn primary" onclick="App.saveTecnico(${editing?`'${jsStr(name)}'`:"null"})">${editing?"Guardar":"Adicionar"}</button>
        </div>
      </div></div>`;
    setTimeout(()=>$("#t-nome").focus(),50);
  }
  function saveTecnico(oldName){
    const nome=$("#t-nome").value.trim(); if(!nome){ alert("Indica o nome."); return; }
    if(!db.tecnicos) db.tecnicos=[];
    const dup = db.tecnicos.some(t=>t.toLowerCase()===nome.toLowerCase() && t!==oldName);
    if(dup){ alert("Esse técnico já existe."); return; }
    if(oldName!=null){
      db.tecnicos = db.tecnicos.map(t=>t===oldName?nome:t);
      db.ordens.forEach(o=>{ if(o.tecnico===oldName) o.tecnico=nome; }); // mantém as assistências coerentes
    } else {
      db.tecnicos.push(nome);
    }
    db.tecnicos.sort((a,b)=>a.localeCompare(b)); save(); closeModal(); renderTecnicos();
  }
  function delTecnico(nome){
    if(db.ordens.some(o=>o.tecnico===nome)){ alert("Não dá para remover: este técnico tem assistências atribuídas."); return; }
    if(!confirm(`Remover o técnico "${nome}"?`)) return;
    db.tecnicos = (db.tecnicos||[]).filter(t=>t!==nome); save(); renderTecnicos();
  }

  // ---------- agenda ----------
  function mondayOf(d){ const x=new Date(d); const off=(x.getDay()+6)%7; x.setDate(x.getDate()-off); x.setHours(0,0,0,0); return x; }
  const isoD = d => { const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; };
  function agendaToday(){ agendaWeek = mondayOf(new Date()); renderAgenda(); }
  function agendaPrev(){ agendaWeek = mondayOf(agendaWeek||new Date()); agendaWeek.setDate(agendaWeek.getDate()-7); renderAgenda(); }
  function agendaNext(){ agendaWeek = mondayOf(agendaWeek||new Date()); agendaWeek.setDate(agendaWeek.getDate()+7); renderAgenda(); }
  function renderAgenda(){
    if(!agendaWeek) agendaWeek = mondayOf(new Date());
    const days=[]; for(let i=0;i<7;i++){ const d=new Date(agendaWeek); d.setDate(d.getDate()+i); days.push(d); }
    const dnames=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
    const fmt = d => d.toLocaleDateString("pt-PT",{day:"2-digit",month:"2-digit"});
    const todayISO = isoD(new Date());
    $("#agenda-range").textContent = `${fmt(days[0])} – ${fmt(days[6])} de ${days[6].getFullYear()}`;

    const sched = scoped().filter(o=>o.tecnico && o.agenda && isOpen(o));
    const techs = [...new Set(scoped().filter(o=>o.tecnico && isOpen(o)).map(o=>o.tecnico))].sort((a,b)=>a.localeCompare(b));
    if(!techs.length){
      $("#agenda-grid").innerHTML = `<div class="empty">Sem técnicos com assistências ativas nesta semana.</div>`;
    } else {
      let h = `<div class="agenda"><div class="ag-head" style="text-align:left;padding-left:12px">Técnico</div>`;
      days.forEach((d,i)=>{ h += `<div class="ag-head ${isoD(d)===todayISO?"today":""}">${dnames[i]}<br>${fmt(d)}</div>`; });
      techs.forEach(t=>{
        h += `<div class="ag-cell ag-tech">${esc(t)}</div>`;
        days.forEach(d=>{
          const di=isoD(d);
          const cell = sched.filter(o=>o.tecnico===t && o.agenda===di);
          h += `<div class="ag-cell">${cell.map(o=>`<span class="ag-chip" style="border-left-color:${STAGE_COLOR[o.estado]}" onclick="App.openDetail('${o.id}')"><span class="ac-cli">${esc(o.cliente)}</span><br>${esc(o.dispositivo||o.id)}</span>`).join("")||'<span class="ag-empty">·</span>'}</div>`;
        });
      });
      h += `</div>`;
      $("#agenda-grid").innerHTML = h;
    }

    // --- vista de lista (telemóvel): agrupada por dia ---
    const dfull=["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"];
    let ml = "";
    days.forEach((d,i)=>{
      const di=isoD(d);
      const items = sched.filter(o=>o.agenda===di).sort((a,b)=>a.tecnico.localeCompare(b.tecnico));
      const hoje = di===todayISO;
      ml += `<div class="agm-day ${hoje?"today":""}">
        <div class="agm-dayhead">${dfull[i]}, ${fmt(d)}${hoje?' · <span style="color:var(--orange)">hoje</span>':""} <span class="muted">${items.length||""}</span></div>
        ${items.length ? items.map(o=>`
          <div class="agm-item" onclick="App.openDetail('${o.id}')">
            <span class="agm-bar" style="background:${STAGE_COLOR[o.estado]}"></span>
            <div class="agm-body">
              <div class="agm-cli">${esc(o.cliente)} <span class="muted">· ${esc(o.tecnico)}</span></div>
              <div class="agm-sub">${esc(devLabel(o))||o.id} — ${ESTADO_LABEL[o.estado]}</div>
            </div>
          </div>`).join("") : `<div class="agm-vazio">Sem agendamentos</div>`}
      </div>`;
    });
    $("#agenda-mobile").innerHTML = ml;

    const todo = scoped().filter(o=>o.tecnico && !o.agenda && isOpen(o));
    $("#agenda-todo").innerHTML = todo.length ? todo.map(o=>`
      <div class="mini-row" style="cursor:pointer" onclick="App.openDetail('${o.id}')">
        <span>${o.id} · ${esc(o.cliente)} <span style="color:var(--muted)">(${esc(o.tecnico)})</span></span>
        <span class="m-val">${ESTADO_LABEL[o.estado]}</span>
      </div>`).join("") : `<div class="empty">Tudo agendado. &#9989;</div>`;
  }

  // ---------- notificações ----------
  function notifList(){
    if(!session) return [];
    return scoped().filter(o => o.estado!=="entregue" && (ADVANCE_PERM[o.estado]||[]).includes(session.role));
  }
  function updateNotif(){
    const n = notifList().length;
    const c = $("#notif-count");
    if(!c) return;
    c.textContent = n>99?"99+":n;
    c.classList.toggle("hidden", n===0);
    if(prevNotif!==null && n>prevNotif) pingBell();
    prevNotif = n;
  }
  function pingBell(){
    const b=$("#notif-btn"), c=$("#notif-count");
    if(b){ b.classList.remove("ring"); void b.offsetWidth; b.classList.add("ring"); setTimeout(()=>b.classList.remove("ring"),850); }
    if(c){ c.classList.remove("pop"); void c.offsetWidth; c.classList.add("pop"); setTimeout(()=>c.classList.remove("pop"),500); }
  }
  function toggleNotif(e){
    e.stopPropagation();
    const w = $("#notif-wrap");
    w.classList.toggle("open");
    if(w.classList.contains("open")){ renderNotif(); document.addEventListener("click", closeNotifOnce); }
  }
  function closeNotifOnce(e){
    const w = $("#notif-wrap");
    if(w && !w.contains(e.target)){ w.classList.remove("open"); document.removeEventListener("click", closeNotifOnce); }
  }
  function renderNotif(){
    const list = notifList();
    $("#notif-sub").textContent = list.length ? list.length+" pendente"+(list.length>1?"s":"") : "";
    if(!list.length){ $("#notif-list").innerHTML = `<div class="notif-empty">Sem ações pendentes para o teu perfil. &#127881;</div>`; return; }
    $("#notif-list").innerHTML = list.slice(0,30).map(o=>`
      <div class="notif-item" onclick="App.openFromNotif('${o.id}')">
        <span class="notif-dot" style="background:${STAGE_COLOR[o.estado]}"></span>
        <div>
          <div class="ni-title">${o.id} · ${esc(o.cliente)}</div>
          <div class="ni-sub">${ESTADO_LABEL[o.estado]} — ${esc(devLabel(o))||"equipamento"}${session.role==="admin"?" · "+esc(lojaNome(o.loja)):""}</div>
        </div>
      </div>`).join("");
  }
  function openFromNotif(id){
    const w=$("#notif-wrap"); w.classList.remove("open"); document.removeEventListener("click", closeNotifOnce);
    openDetail(id);
  }

  // ---------- users (admin) ----------
  function renderUsers(){
    $("#users-body").innerHTML = db.utilizadores.map((u,i)=>`
      <tr>
        <td style="padding-left:20px" data-label="Nome">${esc(u.nome)}</td>
        <td data-label="Utilizador"><code>${esc(u.user)}</code></td>
        <td data-label="Perfil">${ROLE_LABEL[u.role]}</td>
        <td data-label="Loja">${(u.role==="admin"||u.role==="responsavel")?"Todas":esc(lojaNome(u.loja))}</td>
        <td style="padding-right:20px;text-align:right" data-label="">
          <button class="link-btn" onclick="App.openUser(${i})">Editar</button>
          ${u.user==="admin"?"":`<button class="link-btn danger" onclick="App.delUser(${i})">Remover</button>`}
        </td>
      </tr>`).join("");
  }
  function openUser(i){
    currentDetailId = null;
    const u = (i!=null) ? db.utilizadores[i] : {nome:"",user:"",pass:"",role:"operador",loja:"Recoshop"};
    const roleOpts = Object.entries(ROLE_LABEL).map(([k,v])=>`<option value="${k}" ${u.role===k?"selected":""}>${v}</option>`).join("");
    const lojaOpts = window.SEED.lojas.map(l=>`<option value="${l.id}" ${u.loja===l.id?"selected":""}>${esc(l.nome)}</option>`).join("");
    $("#modal-root").innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)App.closeModal()">
      <div class="modal">
        <button class="modal-close" onclick="App.closeModal()">&times;</button>
        <h3>${i!=null?"Editar utilizador":"Novo utilizador"}</h3>
        <p class="sub">O administrador define o perfil (função) e a loja de acesso.</p>
        <div class="form-grid">
          <div class="full"><label>Nome</label><input id="u-nome" value="${esc(u.nome)}"></div>
          <div><label>Utilizador</label><input id="u-user" value="${esc(u.user)}" ${u.user==="admin"?"readonly":""}></div>
          <div><label>Senha</label><input id="u-pass" value="${esc(u.pass)}"></div>
          <div><label>Perfil / função</label><select id="u-role" onchange="App._toggleLoja()">${roleOpts}</select></div>
          <div id="u-loja-wrap"><label>Loja</label><select id="u-loja">${lojaOpts}</select></div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" onclick="App.closeModal()">Cancelar</button>
          <button class="btn primary" onclick="App.saveUser(${i==null?'null':i})">Guardar</button>
        </div>
      </div>
    </div>`;
    _toggleLoja();
  }
  function _toggleLoja(){
    const r = $("#u-role").value;
    const global = r==="admin" || r==="responsavel";
    $("#u-loja-wrap").style.visibility = global ? "hidden":"visible";
  }
  function saveUser(i){
    const nome=$("#u-nome").value.trim(), user=$("#u-user").value.trim(), pass=$("#u-pass").value;
    const role=$("#u-role").value, loja = (role==="admin"||role==="responsavel")?null:$("#u-loja").value;
    if(!nome||!user||!pass){ alert("Preenche nome, utilizador e senha."); return; }
    const dup = db.utilizadores.find((x,j)=>x.user.toLowerCase()===user.toLowerCase() && j!==i);
    if(dup){ alert("Já existe um utilizador com esse nome de acesso."); return; }
    const obj = {nome,user,pass,role,loja};
    if(i==null) db.utilizadores.push(obj); else db.utilizadores[i]=obj;
    save(); closeModal(); renderUsers();
  }
  function delUser(i){
    if(db.utilizadores[i].user==="admin") return;
    if(!confirm(`Remover o utilizador "${db.utilizadores[i].nome}"?`)) return;
    db.utilizadores.splice(i,1); save(); renderUsers();
  }

  // ---------- init ----------
  load();
  applyTheme();
  restoreSession();
  cloudStart();

  return {login, logout, go, renderTable, openNew, createOrder, openDetail, saveDetail, advance, cancelOrder,
          closeModal, resetData, factoryReset, exportMonth, openUser, saveUser, delUser, _toggleLoja, toggleAccount, toggleTheme, setTheme,
          renderClientes, openClient, saveClient, delClient, clienteOrders,
          renderTecnicos, openTecnico, saveTecnico, delTecnico, tecnicoOrders,
          renderAgenda, agendaPrev, agendaNext, agendaToday,
          toggleNotif, openFromNotif, navFromMenu};
})();
