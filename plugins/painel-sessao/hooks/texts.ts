// The texts of the panel in the two languages it is published in. The code is written with the Portuguese text,
// which is also the key: `t('Nenhum prompt anotado.')` answers the same text in Portuguese and its English
// version when the plugin's `language` option is `en`. A text with no English version is shown in Portuguese.

export type Lang = 'pt-BR' | 'en'

let lang: Lang = 'pt-BR'

export function setLang(value: unknown): void {
  lang = value === 'en' ? 'en' : 'pt-BR'
}

export function isEnglish(): boolean {
  return lang === 'en'
}

// The text in the language in force, with each `{name}` replaced by the value of that name
export function t(text: string, values?: Record<string, string | number>): string {
  const base = lang === 'en' ? (EN[text] ?? text) : text
  if (values === undefined) return base

  return base.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}

// The slash commands of the mod, by what each one does: the name in Portuguese and the name in English. Both
// names are answered whatever the language; only the ones of the language in force are listed to the user.
export const COMMANDS = {
  panel: ['painel', 'panel'],
  queue: ['anotar', 'queue'],
  note: ['nota', 'note'],
  auto: ['envio-automatico', 'auto-send'],
  reload: ['painel-recarregar', 'panel-reload'],
} as const

export function commandName(which: keyof typeof COMMANDS): string {
  return COMMANDS[which][lang === 'en' ? 1 : 0]
}

const EN: Record<string, string> = {
  // Names of the panel and of its sections
  'Painel da sessão': 'Session panel',
  Painel: 'Panel',
  'Decisões suas': 'Your decisions',
  Passos: 'Steps',
  'Próximos prompts': 'Next prompts',
  'Minhas últimas mensagens': 'My last messages',
  Notas: 'Notes',
  'Contexto e limites': 'Context and limits',
  'Esta sessão': 'This session',
  Sessões: 'Sessions',

  // Time
  agora: 'just now',
  'há {n} min': '{n} min ago',
  'há {h} h {m} min': '{h} h {m} min ago',
  'há {n} dia': '{n} day ago',
  'há {n} dias': '{n} days ago',
  Hoje: 'Today',
  'Ontem · {date}': 'Yesterday · {date}',
  '{date} · há {n} dias': '{date} · {n} days ago',
  'Antes de o painel ser ligado': 'Before the panel was turned on',
  'reinicia {when}': 'resets {when}',
  '5 horas': '5 hours',
  Semana: 'Week',
  'Limite de gasto': 'Spend limit',
  '⏱ {date} · pergunta {start} · {ended} {end} · {span} ({zone})':
    '⏱ {date} · asked {start} · {ended} {end} · {span} ({zone})',
  resposta: 'answered',
  interrompida: 'interrupted',
  'encerrada com erro': 'ended with an error',

  'não é um fuso horário conhecido; o painel usa o do sistema.':
    "is not a time zone the system knows; the panel uses the system's.",

  // Limits of the lists
  'Anotações já tem {n} linhas, que é o limite. Exclua alguma antes de escrever outra.':
    'Your notes already have {n} lines, which is the limit. Delete one before writing another.',
  'Próximos prompts já tem {n} prompts anotados, que é o limite. Envie ou exclua um.':
    'Next prompts already has {n} queued prompts, which is the limit. Send or delete one.',

  'O prompt tem {n} caracteres e o limite é {max}. Ele não foi anotado.':
    'The prompt has {n} characters and the limit is {max}. It was not queued.',

  // What the model reads about the panel
  'nenhum passo registrado': 'no step recorded',
  nenhum: 'none',
  nenhuma: 'none',
  'Painel da sessão (mod painel-sessao), que o usuário acompanha. Atualize com a ferramenta mcp__painel-sessao__atualizar quando passos, decisões, termos ou pontos mudarem.':
    'Session panel (mod painel-sessao), which the user follows. Update it with the tool mcp__painel-sessao__atualizar when steps, decisions, terms or points change.',
  'Passos no painel agora: ': 'Steps in the panel now: ',
  'Decisões que o usuário precisa tomar, no painel agora: ': 'Decisions the user has to make, in the panel now: ',
  'Termos no painel agora: ': 'Terms in the panel now: ',
  'Pontos no painel agora: ': 'Points in the panel now: ',
  'Sessão ': 'Session ',
  'O painel não foi gravado: o arquivo do mod está cheio. O que aparece continua na tela até o aplicativo reiniciar.':
    "The panel was not saved: the mod's file is full. What is shown stays on screen until the app restarts.",

  // Automatic sending
  'aguardando um agente terminar': 'waiting for an agent to finish',
  'aguardando a pesquisa do aplicativo sair da tela': 'waiting for the app survey to leave the screen',
  'Envio automático: o próximo prompt entra em 5 segundos. Para parar, clique em Cancelar.':
    'Auto-send: the next prompt enters in 5 seconds. To stop it, click Cancel.',
  'prompt enviado: ': 'prompt sent: ',
  'o prompt não entrou na conversa; nova tentativa em seguida':
    'the prompt did not enter the conversation; trying again shortly',
  'o prompt não entrou na conversa em {n} tentativas': 'the prompt did not enter the conversation in {n} attempts',
  'Envio automático desligado: {why}.': 'Auto-send turned off: {why}.',
  'desligado: ': 'turned off: ',
  'um prompt enviado não entrou na conversa e voltou a ficar anotado':
    'a prompt that was sent did not enter the conversation and is queued again',
  'O prompt não foi enviado e continua em Próximos prompts': 'The prompt was not sent and stays in Next prompts',
  'a resposta foi interrompida': 'the answer was interrupted',
  'a resposta terminou com erro': 'the answer ended with an error',
  'Envio automático: ligado': 'Auto-send: on',
  'Envio automático: desligado': 'Auto-send: off',
  'Depois de cada resposta, o primeiro prompt entra em 5 segundos.':
    'After each answer, the first prompt enters in 5 seconds.',
  'Aguardando a pesquisa do aplicativo sair da tela para enviar.':
    'Waiting for the app survey to leave the screen before sending.',
  'Aguardando um agente em segundo plano terminar para enviar.':
    'Waiting for a background agent to finish before sending.',
  'O primeiro prompt entra às {time}.': 'The first prompt enters at {time}.',
  'Desligado às {time}: {why}.': 'Turned off at {time}: {why}.',
  'Último evento do envio automático: {time} · {what}': 'Last auto-send event: {time} · {what}',
  'Envio automático às {time}': 'Auto-send at {time}',
  'envio automático ligado': 'auto-send on',
  'envio automático · ': 'auto-send · ',
  '✕ Cancelar': '✕ Cancel',

  // Filling the panel from the conversation
  'Resuma esta sessão para o painel que o usuário acompanha.': 'Summarize this session for the panel the user follows.',
  'Responda só com um objeto JSON, sem texto antes ou depois e sem bloco de código, com três chaves:':
    'Answer with one JSON object only, with no text before or after it and no code block, with three keys:',
  '"steps": a lista ordenada dos passos da sessão, cada um {"title": frase curta, "status": "done" | "current" | "next"}, com um único "current", até 20;':
    '"steps": the ordered list of the steps of the session, each one {"title": short sentence, "status": "done" | "current" | "next"}, with a single "current", up to 20;',
  '"terms": as siglas, os termos e os conceitos que o usuário precisa lembrar, cada um {"term": texto, "meaning": uma frase}, até 10;':
    '"terms": the acronyms, terms and concepts the user needs to remember, each one {"term": text, "meaning": one sentence}, up to 10;',
  '"points": as decisões e os fatos importantes da sessão, em frases curtas, até 8.':
    '"points": the decisions and the important facts of the session, in short sentences, up to 8.',
  'Escreva em português do Brasil.': 'Write in English.',
  'O painel já está sendo recarregado.': 'The panel is already being reloaded.',
  'Mensagens anteriores recarregadas: {n}. ': 'Earlier messages reloaded: {n}. ',
  'a conversa ainda não tem nenhuma resposta': 'the conversation has no answer yet',
  'a API retornou erro': 'the API returned an error',
  'o modelo respondeu sem texto': 'the model answered with no text',
  'a leitura foi interrompida': 'the reading was interrupted',
  'Passos, termos e pontos não foram recarregados: {why}.': 'Steps, terms and points were not reloaded: {why}.',
  'a resposta do modelo veio fora do formato': "the model's answer was not in the expected format",
  'Passos: {steps}. Termos: {terms}. Pontos: {points}.': 'Steps: {steps}. Terms: {terms}. Points: {points}.',
  'O painel não foi recarregado: {why}.': 'The panel was not reloaded: {why}.',
  'erro sem descrição': 'error with no description',
  'Lendo a conversa para preencher o painel. Leva alguns segundos.':
    'Reading the conversation to fill the panel. It takes a few seconds.',
  '↻ Preencher o painel a partir da conversa': '↻ Fill the panel from the conversation',

  // Commands and the tool the model calls
  'Abre o painel da sessão': 'Opens the session panel',
  'Anota um prompt em Próximos prompts, no painel da sessão, para enviar depois':
    'Queues a prompt in Next prompts, in the session panel, to send later',
  '[texto do prompt]': '[text of the prompt]',
  'Atualiza o painel da sessão que o usuário acompanha. Chame sempre que apresentar próximos passos, alterar o plano, concluir um passo, ou quando surgir sigla, termo, conceito ou decisão que o usuário precisa lembrar. Cada campo é opcional; envie só o que mudou.':
    'Updates the session panel the user follows. Call it whenever you present next steps, change the plan, complete a step, or when an acronym, term, concept or decision comes up that the user needs to remember. Every field is optional; send only what changed.',
  'Lista completa e ordenada dos passos da sessão. Substitui a lista do painel. Um único passo com status "current".':
    'The complete, ordered list of the steps of the session. It replaces the list of the panel. A single step with status "current".',
  'O passo em uma frase curta': 'The step in one short sentence',
  'Siglas, termos e conceitos a adicionar. Um `term` que já existe tem o significado substituído.':
    'Acronyms, terms and concepts to add. A `term` that already exists has its meaning replaced.',
  'O significado em uma frase': 'The meaning in one sentence',
  'Termos a remover do painel': 'Terms to remove from the panel',
  'Lista completa de decisões e fatos importantes da sessão. Substitui a lista do painel. Até 8.':
    'The complete list of decisions and important facts of the session. It replaces the list of the panel. Up to 8.',
  'Lista completa das decisões que você deixou para o usuário tomar e que ele ainda não respondeu, cada uma como uma pergunta curta. Substitui a lista do painel. Envie a lista sem a decisão quando o usuário a responder, e lista vazia quando não restar nenhuma. Até 6.':
    'The complete list of the decisions you left for the user to make and the user has not answered yet, each one as a short question. It replaces the list of the panel. Send the list without a decision once the user answers it, and an empty list when none is left. Up to 6.',
  'Liga (true) ou desliga (false) o envio automático dos prompts que o usuário anotou. Envie só quando o usuário pedir para ligar ou desligar.':
    'Turns auto-send of the prompts the user queued on (true) or off (false). Send it only when the user asks to turn it on or off.',
  'Liga ou desliga o envio automático dos prompts anotados no painel da sessão':
    'Turns auto-send of the queued prompts in the session panel on or off',
  '[ligar | desligar]': '[on | off]',
  'Escreve nas Anotações do painel da sessão; aceita várias linhas e texto colado':
    'Writes to your notes in the session panel; takes several lines and pasted text',
  '[texto]': '[text]',
  'Preenche o painel da sessão a partir da conversa: mensagens enviadas, contexto, passos, termos e pontos':
    'Fills the session panel from the conversation: messages sent, context, steps, terms and points',
  'Prompt anotado: ': 'Prompt queued: ',
  'Escrito em Anotações: ': 'Written to your notes: ',
  'Use /envio-automatico ligar ou /envio-automatico desligar.': 'Use /auto-send on or /auto-send off.',
  'Envio automático ligado. Prompts anotados: {n}. O primeiro entra 5 segundos depois de cada resposta, ou agora, se nenhuma resposta está em curso.':
    'Auto-send is on. Queued prompts: {n}. The first one enters 5 seconds after each answer, or now, if no answer is under way.',
  'Envio automático desligado. Prompts anotados: {n}.': 'Auto-send is off. Queued prompts: {n}.',
  'painel-sessao: a ferramenta só grava no painel da sessão': 'painel-sessao: the tool only writes to the session panel',
  'painel-sessao: só a conversa principal atualiza o painel da sessão.':
    'painel-sessao: only the main conversation updates the session panel.',
  'Painel atualizado: {steps} passos, {terms} termos, {points} pontos.':
    'Panel updated: {steps} steps, {terms} terms, {points} points.',
  ' Decisões do usuário: {n}.': ' Decisions for the user: {n}.',
  ' Envio automático ligado. Prompts anotados: {n}.': ' Auto-send is on. Queued prompts: {n}.',
  ' Envio automático desligado. Prompts anotados: {n}.': ' Auto-send is off. Queued prompts: {n}.',
  'A caixa de várias linhas não funcionou neste aplicativo: {reason}. O painel voltou ao campo de uma linha.':
    'The multi-line box did not work in this app: {reason}. The panel is back to the one-line field.',

  // The band above the prompt and the top of the pane
  '● Passo {n} de {m}': '● Step {n} of {m}',
  'Passo {n} de {m}': 'Step {n} of {m}',
  'prompt anotado': 'queued prompt',
  'prompts anotados': 'queued prompts',
  'Respondendo ': 'Answering · started ',
  'Aguardando você ': 'Waiting for you · ',
  'Nenhuma resposta nesta sessão desde que o painel foi ligado': 'No answer in this session since the panel was turned on',
  'resposta {time}': 'answered {time}',
  '{a} de {b} passos concluídos': '{a} of {b} steps done',

  // The list of sessions
  respondendo: 'answering',
  'aguardando você': 'waiting for you',
  encerrada: 'ended',
  'sem atividade': 'no activity',
  'sem resposta ainda': 'no answer yet',
  'Nenhuma sessão com o painel foi encontrada nesta máquina.': 'No sessions with the panel were found on this machine.',
  ' · esta sessão': ' · this session',
  'sem passos': 'no steps',
  'decisão sua': 'decision for you',
  'decisões suas': 'decisions for you',
  'Só aparecem as sessões desta máquina que têm o painel ligado. A lista é lida a cada minuto.':
    'Only the sessions of this machine with the panel on are listed. The list is refreshed every minute.',

  // Summaries beside the title of a closed section
  'nenhuma pendente': 'none pending',
  'nenhum registrado': 'none recorded',
  '{a} de {b}': '{a} of {b}',
  ' · a seguir: ': ' · next: ',
  'nenhum anotado': 'none queued',
  anotação: 'note',
  anotações: 'notes',
  ponto: 'point',
  pontos: 'points',
  termo: 'term',
  termos: 'terms',
  'sem medição ainda': 'not measured yet',
  '{used}% · {tokens} de {window}': '{used}% · {tokens} of {window}',
  ' · semana {p}%': ' · week {p}%',

  // Context and limits
  'janela de ': 'window of ',
  'Sem medição ainda. Os números aparecem depois da próxima resposta.':
    'Not measured yet. The figures appear after the next answer.',
  '{p}% da janela de contexto em uso': '{p}% of the context window in use',
  'Contexto livre': 'Free context',
  Compactações: 'Compactions',
  'última ': 'last ',
  'Último turno: entrada {input} · saída {output} · cache lido {read} · cache gravado {written}':
    'Last turn: input {input} · output {output} · cache read {read} · cache written {written}',

  // Decisions and steps
  'Nenhuma decisão pendente.': 'No pending decisions.',
  '✓ Resolvida': '✓ Resolved',
  '{a} de {b} concluídos': '{a} of {b} done',
  'Nenhum passo registrado nesta sessão.': 'No steps recorded in this session.',
  '⋮ {n} passo concluído antes': '⋮ {n} earlier step done',
  '⋮ {n} passos concluídos antes': '⋮ {n} earlier steps done',
  ' AGORA ': ' NOW ',
  '⋮ mais {n} passo depois': '⋮ {n} more step',
  '⋮ mais {n} passos depois': '⋮ {n} more steps',
  'Concluir passo atual': 'Complete current step',

  // Next prompts
  '{n} anotado': '{n} queued',
  '{n} anotados': '{n} queued',
  'Clique aqui e escreva um prompt para enviar depois': 'Click here and write a prompt to send later',
  'Enter anota · Ctrl+Shift+Enter quebra a linha': 'Enter queues · Ctrl+Shift+Enter breaks the line',
  'Linhas já guardadas deste prompt': 'Lines of this prompt so far',
  'Escreva um prompt para enviar depois e tecle Enter para anotar. Para várias linhas, use Nova linha.':
    'Write a prompt to send later and press Enter to queue it. For several lines, use New line.',
  'Escreva a próxima linha e tecle Enter para anotar, ou use Nova linha para continuar o prompt.':
    'Write the next line and press Enter to queue it, or use New line to go on with the prompt.',
  Anotar: 'Queue',
  '↵ Nova linha': '↵ New line',
  '✕ Limpar linhas': '✕ Clear lines',
  'Voltar ao campo de uma linha': 'Back to the one-line field',
  'Testar caixa larga de várias linhas': 'Try the wide multi-line box',
  'Nenhum prompt anotado.': 'No queued prompts.',
  '⋮ mais {n} linha': '⋮ {n} more line',
  '⋮ mais {n} linhas': '⋮ {n} more lines',
  'Enviado. Entra na conversa quando a resposta atual terminar.':
    'Sent. It enters the conversation when the current answer ends.',
  '➤ Enviar': '➤ Send',
  '▴ Ver menos': '▴ Show less',
  '▾ Ver tudo': '▾ Show all',
  '↑ Subir': '↑ Move up',
  '↓ Descer': '↓ Move down',
  '✎ Pôr na caixa': '✎ Move to the prompt box',
  '⧉ Copiar': '⧉ Copy',
  '✕ Excluir': '✕ Delete',
  'A caixa de prompt não aceitou o texto. O prompt continua em Próximos prompts.':
    'The prompt box did not take the text. The prompt stays in Next prompts.',

  // My last messages
  'Nenhuma mensagem enviada desde que o painel foi ligado.': 'No messages sent since the panel was turned on.',
  'antes ↗': 'earlier ↗',
  '▾ Carregar mais {n}': '▾ Load {n} more',
  '▴ Mostrar só 5': '▴ Show only 5',
  'Não achei essa mensagem na conversa. Ela ainda não apareceu na tela com o painel ligado.':
    'This message was not found in the conversation. It has not been shown on screen yet with the panel on.',
  'A conversa não rolou até a mensagem: ': 'The conversation did not scroll to the message: ',

  // Notes
  'Pontos importantes': 'Important points',
  'Nenhum ponto registrado.': 'No points recorded.',
  Termos: 'Terms',
  'Nenhum termo registrado.': 'No terms recorded.',
  'Suas anotações': 'Your notes',
  '{n} linha': '{n} line',
  '{n} linhas': '{n} lines',
  'Nenhuma anotação nesta sessão. O que você escreve aqui fica só no painel.':
    'No notes in this session. What you write here stays in the panel only.',
  'Escreva uma anotação e tecle Enter. Cada Enter começa uma linha.': 'Write a note and press Enter. Each Enter starts a line.',
  'Altere a linha {n} e tecle Enter.': 'Change line {n} and press Enter.',
  Escrever: 'Write',
  Salvar: 'Save',
  '↑ Subir linha': '↑ Move line up',
  '↓ Descer linha': '↓ Move line down',
  'Cancelar a alteração': 'Cancel the change',
  '⧉ Copiar tudo': '⧉ Copy all',
  '✕ Limpar tudo': '✕ Clear all',
  'Excluir todas as anotações?': 'Delete all notes?',
  Excluir: 'Delete',
  Manter: 'Keep',
  '⧉ Copiar passos, decisões, pontos e termos': '⧉ Copy steps, decisions, points and terms',
}

// The names the list of messages and the limits of the plan give the days of the week and the months
export const WEEKDAYS: Record<Lang, readonly string[]> = {
  'pt-BR': ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const two = (n: number): string => String(n).padStart(2, '0')

// A date as each language writes it: 02/10/2026 in Portuguese, 02 Oct 2026 in English, which no reader takes
// for the 10th of February
export function dateText(year: number, month: number, day: number): string {
  return lang === 'en' ? two(day) + ' ' + (MONTHS[month - 1] ?? '') + ' ' + year : two(day) + '/' + two(month) + '/' + year
}

export function weekdayText(weekday: number): string {
  return WEEKDAYS[lang][weekday] ?? ''
}

// A number with one decimal place as each language writes it: 441,2 in Portuguese, 441.2 in English
export function decimal(value: number | string): string {
  return lang === 'en' ? String(value) : String(value).replace('.', ',')
}
