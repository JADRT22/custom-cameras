# Custom Cameras (Menu)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Minecraft Bedrock](https://img.shields.io/badge/Minecraft%20Bedrock-26.50-62b47a)](#compatibilidade)
[![Release](https://img.shields.io/github/v/release/JADRT22/custom-cameras)](https://github.com/JADRT22/custom-cameras/releases)

[English](README.md) · **Português**

Câmeras predefinidas para **Minecraft Bedrock**: ombro, distante e cinematográfica, trocadas por
um menu no jogo ou por comandos. Funciona em qualquer mundo **sem cheats e sem experimento**, e o
mundo mantém as conquistas.

<!-- TODO: adicionar um GIF do menu abrindo (segure Shift por 2s) aqui -->

| Sobre o ombro direito (`right`) | Sobre o ombro esquerdo (`left`) |
| --- | --- |
| ![Ombro direito](docs/right-shoulder.png) | ![Ombro esquerdo](docs/left-shoulder.png) |

As duas câmeras de ombro são o mesmo enquadramento espelhado. Sobre o ombro **direito**, a câmera
fica à sua direita e você aparece do lado esquerdo da tela (e vice-versa).

## Recursos

- 7 câmeras, todas acessíveis pelo menu ou por comandos
- O menu abre ao **segurar Shift parado por 2 segundos**
- Lembra a última câmera, por jogador e por mundo
- Restaura a câmera depois de morrer ou renascer
- Pausa automaticamente ao dormir, montar ou planar, e restaura depois
- Movimento suave, controlado pelo motor do jogo (presets nativos, sensação de terceira pessoa vanilla)
- Textos em inglês e português (pt_BR)

## Instalação

1. Baixe o `CameraMenu-v1.1.1.mcaddon` na página de [Releases](https://github.com/JADRT22/custom-cameras/releases).
2. Abra o arquivo com o Minecraft para importar.
3. No seu mundo, vá em **Behavior Packs** (Pacotes de Comportamento) e ative o **Camera Menu**.

Só isso. Deixe os cheats **desligados** e não ative nenhum experimento: nenhum dos dois é
necessário, e ligar qualquer um custa as conquistas do mundo à toa.

## Câmeras

| Câmera | Descrição | `/cameramenu:set` |
| --- | --- | --- |
| Default | Volta para a primeira pessoa | `default` |
| Left Shoulder | Câmera sobre o ombro esquerdo; você aparece à direita da tela | `left` |
| Center Shoulder | Mesma distância dos ombros, diretamente atrás de você | `center` |
| Right Shoulder | Câmera sobre o ombro direito; você aparece à esquerda da tela | `right` |
| Boom Shoulder | Distância fixa, sem órbita e sem deslocamento lateral | `boom` |
| Far | Terceira pessoa distante | `far` |
| Low Cinematic | Câmera livre baixa atrás do jogador, volta sozinha após 3s. **Experimental**, veja [Problemas conhecidos](#problemas-conhecidos) | `low` |

## Comandos

Todos funcionam **sem cheats**.

| Comando | O que faz |
| --- | --- |
| `/cameramenu:open` | Abre o menu de câmeras |
| `/cameramenu:set <default\|left\|center\|right\|boom\|far\|low>` | Troca direto para uma câmera |
| `/cameramenu:next` | Alterna entre as câmeras persistentes |
| `/cameramenu:reset` | Volta ao padrão (a saída de emergência) |

O menu também abre sozinho quando você segura **Shift parado** por 2 segundos. Mova-se para
cancelar o timer.

## Observações

- **Sem mira.** Quando a câmera se solta do jogador, a mira vanilla some. Isso é esperado.
- **Animações de agachar.** Segurar Shift é agachar, então qualquer pack de animação que você use (por exemplo Actions & Stuff) vai tocar a animação de agachar enquanto o timer corre.
- **Conquistas** também exigem modo Sobrevivência, independentemente de qualquer pack.

## Compatibilidade

| Componente | Versão |
| --- | --- |
| Minecraft Bedrock | 26.50 |
| `@minecraft/server` | 2.10.0 |
| `@minecraft/server-ui` | 2.2.0 |
| Add-on | 1.1.1 |

As versões da Script API mudam com frequência. Outras versões do jogo não foram testadas e podem exigir ajustes em `scripts/main.js` e no manifest.

## Problemas conhecidos

- **A Low Cinematic não foi verificada.** Ela usa a câmera `minecraft:free` pela Script API, a mesma forma que acabou não renderizando no 26.50. Pode não fazer nada. Se estiver morta, será removida.
- Os presets de câmera são lidos quando o mundo carrega, então mudar os valores exige reentrar no mundo (veja [Ajuste fino](#ajuste-fino-das-câmeras)).

## Solução de problemas

**Nada acontece e não aparece mensagem.** O pack precisa estar ativado em **Behavior Packs** naquele mundo. É o único requisito.

**O chat diz que o jogo rejeitou um preset de câmera.** Um preset falhou na validação do schema. Veja o `ContentLog*.txt` mais recente por `Invalid camera preset` ou `Failed to load camera presets`, que indica o campo com problema. As regras do schema estão em [docs/INTERNALS.md](docs/INTERNALS.md).

**Minhas conquistas estão desativadas e nunca usei cheats.** Ou o mundo já teve um experimento ativado, ou o manifest do pack está sem `"metadata": { "product_type": "addon" }` (este repositório já tem). Para checar um mundo:

```
python3 build/nbt_experiments.py "<mundo>/level.dat"
```

Se `experiments_ever_used` for `1`, o mundo já foi marcado e o jogo não devolve as conquistas.

## Desenvolvimento

### Build e instalação

```
python3 build.py            # valida + empacota dist/*.mcaddon
python3 build.py --install  # também instala em development_behavior_packs/
python3 build.py --icon     # (re)gera o pack_icon.png
```

O build se recusa a empacotar se o manifest, os UUIDs, os módulos, as dependências, todos os
presets de câmera e os dois arquivos `.lang` não passarem na validação.

O `build.py` lê o diretório do jogo em `GAME_DIR`, que hoje aponta para o caminho Flatpak do
launcher (`~/.var/app/com.trench.trinity.launcher/...`). Ajuste para o seu setup.

### Ajuste fino das câmeras

```
python3 tune.py               # mostra os valores atuais
python3 tune.py --y 0.4       # sobe a câmera de ombro
python3 tune.py --x 1.5       # afasta o jogador para o lado
python3 tune.py --radius 1.5  # câmeras de ombro mais perto (menor = mais apertado)
python3 tune.py --far 12      # distância da câmera Far
```

O `tune.py` reescreve os presets e reinstala. Reentre no mundo para recarregar. Você também
pode editar `cameras/presets/<nome>.json` à mão e rodar `python3 build.py --install`.

### Estrutura do repositório

```
src/camera_menu_bp/        o behavior pack em si (é isso que vai no release)
  manifest.json            UUIDs, módulos, dependências
  cameras/presets/*.json   um preset nativo de câmera por arquivo
  scripts/main.js          menu, comandos, persistência
  texts/*.lang             nome / descrição do pack (en_US, pt_BR)
build.py                   valida + empacota + instala
build/                     scripts auxiliares (listar .brarchive, NBT do level.dat, gerar ícone)
tune.py                    calibra o enquadramento das câmeras de ombro + reinstala
play.sh                    ativa um experimento nos mundos (não use, veja abaixo)
ans_toggle.sh              auxiliar de teste para isolar um resource pack global
docs/                      capturas de tela e internals
```

> **Sobre o `play.sh`:** ele liga o `experimental_creator_cameras`, que este add-on **não** precisa,
> e isso desativa permanentemente as conquistas do mundo. Ele se recusa a rodar sem `--yes`.
> Deixe de lado a não ser que saiba por que quer usá-lo.

## Mais documentação

- [docs/INTERNALS.md](docs/INTERNALS.md): regras do schema, notas de engenharia e a câmera de script escondida (em inglês)
- [CHANGELOG.md](CHANGELOG.md)

## Licença

[MIT](LICENSE)
