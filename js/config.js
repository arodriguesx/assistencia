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
  SUPABASE_URL: "",       // ex.: https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: ""   // a chave "anon public" do projeto
};
