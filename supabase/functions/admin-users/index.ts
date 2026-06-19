// Edge Function: admin-users
// Gestão de contas (Supabase Auth + tabela profiles) feita só pelo administrador.
// A service_role NUNCA vai para o navegador — fica só aqui, no servidor do Supabase.
//
// Deploy: Supabase Dashboard → Edge Functions → New function "admin-users" → colar este código → Deploy.
// (As variáveis SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são injetadas automaticamente.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["operador", "responsavel", "admin"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

  const admin = createClient(URL, SERVICE);

  // 1) identificar quem chama (a partir do token enviado pela app)
  const authHeader = req.headers.get("Authorization") || "";
  const caller = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json(401, { error: "Não autenticado." });

  // 2) confirmar que o chamador é admin
  const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!me || me.role !== "admin") return json(403, { error: "Sem permissão (apenas administrador)." });

  let body: any = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }
  const action = body.action;

  try {
    if (action === "list") {
      const { data, error } = await admin.from("profiles").select("id,nome,email,role,loja").order("nome");
      if (error) throw error;
      return json(200, { users: data });
    }

    if (action === "create") {
      const { email, password, nome, role, loja } = body;
      if (!email || !password) return json(400, { error: "Email e senha são obrigatórios." });
      if (!ROLES.includes(role)) return json(400, { error: "Perfil inválido." });
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return json(400, { error: error.message });
      const loja2 = (role === "admin" || role === "responsavel") ? null : loja;
      const { error: pe } = await admin.from("profiles").insert({ id: data.user.id, nome, email, role, loja: loja2 });
      if (pe) { await admin.auth.admin.deleteUser(data.user.id); return json(400, { error: pe.message }); }
      return json(200, { ok: true, id: data.user.id });
    }

    if (action === "update") {
      const { id, nome, role, loja, password } = body;
      if (!id) return json(400, { error: "Conta em falta." });
      if (!ROLES.includes(role)) return json(400, { error: "Perfil inválido." });
      const loja2 = (role === "admin" || role === "responsavel") ? null : loja;
      const { error } = await admin.from("profiles").update({ nome, role, loja: loja2 }).eq("id", id);
      if (error) throw error;
      if (password) {
        const { error: ue } = await admin.auth.admin.updateUserById(id, { password });
        if (ue) return json(400, { error: ue.message });
      }
      return json(200, { ok: true });
    }

    if (action === "delete") {
      const { id } = body;
      if (!id) return json(400, { error: "Conta em falta." });
      if (id === user.id) return json(400, { error: "Não podes remover a tua própria conta." });
      const { error } = await admin.auth.admin.deleteUser(id); // cascata remove o profile
      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(400, { error: "Ação inválida." });
  } catch (e) {
    return json(500, { error: String((e as Error).message || e) });
  }
});
