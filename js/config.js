// Configuração da sincronização na nuvem (Supabase) — OPCIONAL.
//
// Com os campos vazios, a app funciona em MODO LOCAL (dados só neste navegador).
// Para PARTILHAR os dados entre colaboradores em tempo real, cria um projeto
// gratuito em https://supabase.com e cola aqui as duas chaves (ver README).
//
// Atenção: a "anon key" fica visível no navegador (é normal no Supabase). Para a
// fase de testes está ok; para dados sensíveis reais deve-se ativar autenticação
// e políticas de acesso (RLS) adequadas.

window.TECNOASSIST_CONFIG = {
  SUPABASE_URL: "https://deyuhpxwyinzmobgfpdg.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleXVocHh3eWluem1vYmdmcGRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NzIyODMsImV4cCI6MjA5NzM0ODI4M30.fGLZOZKl-Gk-IlDXLcmeQeTCcFgpRSGP8-lLJMS3JQQ"
};
