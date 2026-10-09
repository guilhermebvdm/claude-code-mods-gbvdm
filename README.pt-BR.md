# claude-code-mods-gbvdm

Mods para o [Claude Code](https://code.claude.com/docs/en/plugins/mods/overview). Um mod é um plugin que desenha na interface do Claude Code e reage aos eventos dele.

Read in English: [README.md](./README.md)

## painel-sessao: um painel para cada sessão

Um painel que fica ao lado da conversa e mostra, de relance, em que ponto a sessão está e o que ela aguarda.

| Seção | O que mostra |
|---|---|
| Topo | Se o Claude está respondendo ou aguardando você, há quanto tempo, o passo atual e uma barra de progresso |
| Decisões suas | As perguntas que o Claude deixou para você decidir, até você responder |
| Passos | Os dois últimos passos concluídos, o atual marcado e os próximos |
| Próximos prompts | Prompts que você anota enquanto o Claude trabalha. Envie com um clique, reordene, ou ligue o envio automático |
| Minhas últimas mensagens | Suas últimas mensagens com o horário. Clique no horário para a conversa ir até a mensagem |
| Notas | Pontos importantes e termos da sessão, e as suas anotações livres |
| Contexto e limites | Quanto da janela de contexto está em uso, os limites do seu plano, o último turno e as compactações |
| Sessões (segunda visão) | As outras sessões da mesma máquina que usam o painel: respondendo, aguardando você, encerrada |

O Claude mantém passos, decisões, termos e pontos atualizados por uma ferramenta que o mod registra. O resto é seu: a fila de prompts, as anotações, os botões.

### O que muda nas suas sessões

Três coisas acontecem sem você pedir, e duas delas têm opção para desligar:

- O painel abre sozinho uma vez em cada sessão nova (opção `openOnStart`).
- Cada resposta termina com uma linha: a data, a hora da pergunta, a hora em que a resposta terminou e a duração (opção `answerLine`).
- Uma faixa acima do prompt mostra o passo atual e quantos prompts estão anotados, enquanto existe passo atual ou prompt anotado.

### Requisitos

- Claude Code 2.1.287 ou mais novo no terminal, ou a aba Code do aplicativo Claude Desktop.
- O painel aparece no terminal e no aplicativo desktop. Na extensão do VS Code e no celular os comandos funcionam e nada é desenhado.

### Instalação

O painel vem em português:

```bash
claude plugin marketplace add guilhermebvdm/claude-code-mods-gbvdm
```

```bash
claude plugin install painel-sessao@gbvdm-mods
```

Abra uma sessão nova, ou rode `/reload-plugins` numa sessão aberta. Numa sessão que já estava em andamento, rode `/painel-recarregar` para preencher o painel a partir da conversa.

### Opções

| Opção | Valores | Padrão |
|---|---|---|
| `language` | `pt-BR` ou `en` | `pt-BR` |
| `timeZone` | Um nome de fuso horário IANA, como `America/Sao_Paulo` ou `Europe/Lisbon` | vazio: o fuso horário do sistema |
| `openOnStart` | `true` ou `false` | `true` |
| `answerLine` | `true` ou `false` | `true` |

Defina na instalação, com um `--config` para cada uma:

```bash
claude plugin install painel-sessao@gbvdm-mods --config timeZone=America/Sao_Paulo --config answerLine=false
```

Ou depois, numa sessão, na linha do plugin em `/plugin`.

### Comandos

| Português | Inglês | O que faz |
|---|---|---|
| `/painel` | `/panel` | Abre o painel |
| `/anotar <texto>` | `/queue <texto>` | Anota um prompt em Próximos prompts, sem iniciar um turno |
| `/nota <texto>` | `/note <texto>` | Escreve nas suas anotações. Aceita várias linhas |
| `/envio-automatico [ligar\|desligar]` | `/auto-send [on\|off]` | Liga ou desliga o envio automático |
| `/painel-recarregar` | `/panel-reload` | Preenche o painel a partir da conversa |

O mod registra e responde os nomes do idioma em uso. Os nomes do outro idioma não são comandos dele.

### Envio automático

Com o envio automático ligado, o primeiro prompt anotado entra 5 segundos depois de cada resposta, e o painel mostra a hora e um botão Cancelar durante esses 5 segundos.

- Com o envio ligado e nenhuma resposta em curso, um prompt anotado é enviado em até 20 segundos, sem resposta no meio.
- Ele aguarda enquanto um agente em segundo plano está em execução e, por até 3 minutos, enquanto o aplicativo mostra a pesquisa sobre a sessão.
- Um prompt que não entra na conversa é enviado de novo em até 20 segundos. Depois de 3 falhas seguidas o envio automático desliga.
- Uma resposta que você interrompe, ou que termina com erro, desliga o envio, e o painel mostra o motivo.
- Em toda sessão nova ele começa desligado.

### O que este mod acessa

Um mod é código que roda com as suas permissões. Leia esta lista antes de instalar, e confira você mesmo: clone o repositório e rode `claude plugin validate plugins/painel-sessao`, cujas linhas `hooks:` e `calls:` listam os eventos que o mod trata e o que ele pede ao Claude Code.

- **Ele lê os seus prompts.** Guarda os primeiros 300 caracteres de cada um para listar no painel.
- **Ele envia prompts como se fosse você.** O botão Enviar e o envio automático enviam um prompt anotado como se você tivesse digitado. Só prompts que você anotou são enviados.
- **Ele aprova a própria ferramenta.** O Claude chama `mcp__painel-sessao__atualizar` sem pedido de permissão para gravar passos, decisões, termos e pontos no painel. Uma chamada que liga o envio automático não é aprovada pelo mod: o pedido de permissão aparece, como para qualquer ferramenta. Uma regra sua que nega a ferramenta continua valendo.
- **Ele adiciona um texto curto aos seus prompts.** Quando o painel mudou desde o último prompt, o seguinte leva os passos, as decisões, os termos e os pontos, para o Claude saber o que o painel mostra. Esse texto também vai com o primeiro prompt de uma sessão e depois de cada compactação. Com um prompt enviado pelo painel, ele vai como uma linha separada da conversa, que só o modelo lê.
- **Ele pode consumir o uso do seu plano.** O `/painel-recarregar` e o botão "Preencher o painel a partir da conversa" leem a conversa inteira e pedem um resumo ao modelo. Nada mais chama um modelo. A ferramenta fica na lista de ferramentas de toda requisição, e o Claude chama a ferramenta quando o plano muda, o que adiciona alguns tokens aos turnos comuns.
- **Ele grava na área de transferência e na caixa de prompt quando você clica.** Os botões de copiar copiam texto, e "Pôr na caixa" coloca um prompt anotado na caixa de prompt.
- **Ele grava o painel na sua máquina.** Um arquivo JSON em `~/.claude/plugins/store/` contém, para cada sessão: passos, decisões, termos e pontos; os prompts anotados e as linhas de um que está sendo escrito; as suas anotações; o início das suas mensagens e os códigos das linhas delas na conversa; o título da sessão ou o nome da pasta dela; o que o envio automático fez por último, com os primeiros 60 caracteres de cada prompt enviado; e quais botões do painel foram clicados por último. O que é de uma sessão é excluído depois de 30 dias sem atividade, e o arquivo guarda o que é das 40 outras sessões que gravaram por último.

Ele não faz requisição de rede, não inicia processo e não lê nem grava arquivo além desse.

### Limites conhecidos

- Um prompt anotado tem no máximo 4000 caracteres, a fila 30 prompts e as anotações 200 linhas. O que passa disso é recusado com um aviso, nunca cortado. Uma exceção: uma linha das anotações com mais de 1000 caracteres é cortada em 1000.
- O campo de uma linha do aplicativo desktop tem a largura que o aplicativo define. O botão "Testar caixa larga de várias linhas" troca o campo por uma caixa da largura do painel. Essa caixa não foi conferida no aplicativo desktop.
- O aplicativo desktop troca o conteúdo do painel a cada redesenho, então uma seleção feita com o mouse não dura. Os botões de copiar existem por isso.
- O mod foi escrito e usado no Windows, no aplicativo desktop, em português. Não foi rodado no macOS nem no Linux, o painel nunca foi visto num terminal, e a versão em inglês foi conferida só por testes automáticos. Os testes cobrem as superfícies de terminal e de desktop sem desenhá-las.
- Este plugin e uma cópia dele carregada com `--plugin-dir` ou `CLAUDE_CODE_PLUGIN_DIRS` têm o mesmo nome: com as duas, a instalada não carrega.

### Desenvolvimento

```bash
claude plugin validate plugins/painel-sessao
```

```bash
claude plugin test plugins/painel-sessao
```

Os testes rodam com os horários no fuso de São Paulo, qualquer que seja o fuso da máquina. O `plugins/painel-sessao/tsconfig.json` estende as declarações de tipos que o Claude Code grava ao lado de um plugin quando carrega o plugin (`.claude-plugin/types/`, fora do repositório): carregue o plugin uma vez antes de rodar o `tsc`. O arquivo `plugins/painel-sessao/.diagramas.md` tem diagramas de sequência das partes com mais lógica.

## Licença

[MIT](./LICENSE)
