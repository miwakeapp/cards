# Known Card-Field Generation Failures

These cases should become eval fixtures as the suite grows coverage for sense selection, hint generation, contextual expression targets, and JMDict granularity failures.

## Ankidrone JLPT Tango N1

| Target     | Context                                            | Expected                                    | Observed issue                                                                    |
| ---------- | -------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| キャッチ   | 高く上がったボールを見事にキャッチした。           | JMDict 1041530 sense 2                      | The model selected sense 1, merging physical catching with obtaining information. |
| 息が切れる | そんなに頑張りすぎると、途中で息が切れるよ。       | JMDict 2656000 sense 2                      | The model selected the physical breathlessness sense.                             |
| タイト     | このスカートはタイトで動きにくい。                 | Needs JMDict split or manual handling       | JMDict 1075880 does not distinguish physical tightness from schedule tightness.   |
| タイト     | 今日はスケジュールがタイトな一日だ。               | Needs JMDict split or manual handling       | Same JMDict granularity problem as above.                                         |
| 不味い     | 不味い。彼との約束を忘れてた。                     | Unconvertible for now                       | JMDict 1495000 does not expose the interjection-like usage distinctly.            |
| さっぱり   | 晩御飯はさっぱりしたものが食べたい。               | Unconvertible for now                       | JMDict 1005210 does not expose the light-food usage distinctly enough.            |
| 起こす     | 弟もやっとやる気を起こした。                       | Unconvertible for now                       | JMDict 1223660 does not expose this collocation distinctly enough.                |
| 繫がる     | 友達に電話しているが、中々繫がらない。             | Unconvertible for now                       | JMDict 1251880 does not expose phone-call connection distinctly enough.           |
| 跳ねる     | 天麩羅を揚げていたら、油が跳ねた。                 | Unconvertible for now                       | JMDict 1429620 does not expose oil/liquid splattering distinctly enough.          |
| 摘む       | 山には沢山の花が咲いていたので、摘んで持ち帰った。 | JMDict 1437060 sense 1, reading つむ        | The model/source path selected 1598080 with reading つまむ.                       |
| 摘む       | 盛り付けの前に、少し摘んで味見をする。             | JMDict 1598080 sense 2, reading つまむ      | Needs distinct sense selection from 鼻を摘む.                                     |
| 摘む       | 変な臭いがして鼻を摘んだ。                         | JMDict 1598080 sense 1, reading つまむ      | Needs distinct sense selection from tasting/snacking.                             |
| 滑る       | 手が滑って料理を落とした。                         | Recognition target 手が滑る, JMDict 2399520 | The model/source path selected plain 滑る sense 2.                                |
| 滑る       | 口が滑って本音を言ってしまった。                   | Recognition target 口が滑る, JMDict 1640380 | The model/source path selected plain 滑る sense 2.                                |

## Animecards conversion

| Target     | Context                                                                                                    | Expected                                                      | Observed issue                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 大綱       | 羊博士は本土と満州とモンゴルにおける緬羊増産計画の大綱をまとめた後、現地視察のために翌年の春満州に渡った。 | JMDict 1661030 sense 2                                        | The model selected both compatible senses, producing an unsuffixed key instead of sense 2.                                     |
| 木綿       | 写真の中の回鍋肉のおじさんは箸をマイクにして「木綿のハンカチーフ」を熱唱している。                         | JMDict 1534870 sense 1; context-grounded hint 木綿ハンカチ    | The entry and sense were correct, but the model invented the unrelated hint 木綿豆腐.                                          |
| つきもの   | スタンドアロンRPGにはつきものの勝利ファンファーレが聞こえてきそうだ。                                      | JMDict 1495730 sense 1; context-grounded hint RPGにはつきもの | The sense was correct, but the model chose the awkward phrase boundary つきものの勝利 as its hint.                             |
| イエス     | そんで神様、途中で自分の息子さん……イエスさんを地球に送り込んだりしたんだけど。                             | JMDict 1021010; hint イエスさん                               | The model chose イエス・キリスト, which gives away this unusual name-recognition card.                                         |
| 沽券       | もちろん沽券をかけて父が弁償したが。                                                                       | JMDict 1568610 sense 1; hint 沽券をかける                     | The model copied the inflected context form 沽券をかけて instead of using the dictionary form.                                 |
| トラック   | トラックに乗ったパンとお弁当が届いて並べ始めているころだ。                                                 | JMDict 1085760; hint トラックに乗る                           | The model copied the unnecessarily inflected hint トラックに乗った.                                                            |
| ハイタッチ | ばしんとハイタッチをかわしてから、俺はもう一度笑った。                                                     | JMDict 1095190; hint ハイタッチをかわす                       | The model changed source かわす to 交わす without a reason.                                                                    |
| 甲子園     | 甲子園出場を賭けた地区大会で優勝した時の写真もある。                                                       | All three senses of JMDict 2092720; no hint                   | The model selected only sense 1 even though the context does not distinguish stadium, summer tournament, or spring tournament. |
| ヅラ       | お前もその野武士ヅラのほうが十倍似合ってるよ！                                                             | JMDict 2266240; target ～ヅラ; no hint                        | The model added 野武士ヅラ even though affix notation already distinguishes the suffix entry.                                  |
| 白鯨       | 実はメルヴィルの『白鯨』にいるかの出てくるシーンがあったからなんです。                                     | JMDict 5592543; hint 『白鯨』                                 | The model chose 小説白鯨. Title punctuation is preferable, but this rare special case is probably not worth prompt complexity. |
| ぞくぞく   | それを見てうれしくて背筋がぞくぞくした。                                                                   | JMDict 1007140 sense 3; hint 嬉しくてぞくぞく                 | Gemini 3.6 Flash chose 背筋がぞくぞくする, which suggests shivering or fear instead of the selected “thrilled” sense.          |

## Exposure migration

These Gemini 3.6 Flash outputs selected acceptable entries and senses, but generated hints that invented context, changed the source's relationship, or chose an unhelpful phrase boundary. They are useful fixtures for preferring concise source-grounded wording without mechanically copying inflection.

| Target   | Context                                                                          | Expected hint                | Observed hint  |
| -------- | -------------------------------------------------------------------------------- | ---------------------------- | -------------- |
| 可愛がる | 彼には愛嬌があって、確かに可愛がられている。                                     | 可愛がられる                 | 部下を可愛がる |
| 打合せ   | 打合せを中心に計画を立ててくれないと、話がなかなか先に進みません。               | 打合せを中心に               | 事前打合せ     |
| 移転     | 万が一移転することになったら、僕の仕事は君にお願いしたい。                       | 移転することになる           | 事務所移転     |
| すれ違う | 昨日すれ違ったの、まさか君じゃないよね？                                         | 君とすれ違う                 | 道ですれ違う   |
| 雇う     | いろいろ面接した末に、大企業に雇われたんだ。                                     | 大企業に雇われる             | 人を雇う       |
| お出掛け | 急用が入ったので、お出掛けどころではなくなった。                                 | お出掛けどころではない       | お出掛け先     |
| 怒る     | 彼はあれだけ怒られて悲しんでいるかと思ったら、すぐに笑いだした。                 | 怒られる                     | 子供を怒る     |
| バレる   | 知らないふうにしていたが、顔に出てバレてしまった。                               | 顔に出てバレる               | 嘘がバレる     |
| あっさり | 嫌がられるかと思ったら、あっさりOKしてくれた。                                   | あっさりOKする               | あっさり承諾   |
| 慌てる   | あなたの部下には慌てて計画の実装を終えるように命じてくれたまえ。                 | 慌てて実装を終える           | 慌てる実装     |
| 触る     | 今日は鑑賞だけということだから、触ってはいけません。                             | 触ってはいけない             | 展示に触る     |
| 素直     | 素直であるということは、君の表情からも分かります。                               | 素直である                   | 素直な気持ち   |
| 優勝     | 肉体をさらに強化できれば、来年は優勝も夢ではない。                               | 優勝も夢ではない             | 優勝を目指す   |
| 旅立つ   | 夜明けと共に旅立った。                                                           | 夜明けと共に旅立つ           | 旅路へ旅立つ   |
| 雪解け   | 雪解けにつれて川や湖の水のかさがさらに増す一方だ。                               | 雪解けにつれて               | 雪解け水       |
| 出産     | 出産には、我慢強さが必要です。                                                   | 出産には我慢強さが必要       | 出産に耐える   |
| 装う     | 思ってもいないのに、好きだと思っているふうに装うのは不誠実だ。                   | 好きだと思っているふうに装う | 関心を装う     |
| 間に合う | 携帯の電池がなくなるところだったが、なんとか間に合った。                         | なんとか間に合う             | 時間に間に合う |
| 下水     | 村にせよ大都市にせよ、近代では下水は絶対必要だ。                                 | 近代では下水が必要           | 下水設備       |
| 距離     | この程度の距離で音を上げているようでは、本格的な登山に挑戦することなどできない。 | この程度の距離               | 移動距離       |
| いかす   | マイクは君の妹のこと、とびきりいかしてるって思ってるんだ。                       | とびきりいかす               | いかす服       |
| 自発     | 彼はいつも自発的に掃除をしてくれます。                                           | 自発的に掃除する             | 自発的な行動   |
| 徐々     | 列車は徐々にスピードを上げた。                                                   | 徐々にスピードを上げる       | 徐々に上がる   |
| 曖昧     | あの人の説明は、曖昧な上に不正確だ。                                             | 説明は曖昧                   | 曖昧な説明     |
| 貪欲     | 普段は貪欲ではない人でも、莫大な金額ともなると貪欲になるかもしれない。           | 貪欲になる                   | 金銭に貪欲     |
| 見出し   | その俳優の死は各紙で大見出しで報じられた。                                       | 大見出しで報じる             | 新聞の見出し   |
| ゲロ     | 私は大変気分が悪い。ゲロをはきたいです。                                         | ゲロをはく                   | ゲロを吐く     |
| にらむ   | 彼は私をにらんだ。                                                               | 私をにらむ                   | 人をにらむ     |
| 整理券   | 最悪・・・入場制限を設けるしかないでしょう。整理券の配布とかで。                 | 整理券の配布                 | 整理券配布     |
| 惚れる   | 惚れた欲目。                                                                     | 惚れた欲目                   | 惚れる欲目     |
| 麗しい   | 麗しの友よ、私にとってあなたは永遠に若いのだ。                                   | 麗しの友                     | 麗しい友       |

### Duplicate-aware batch

These additional Gemini 3.6 Flash failures came from the duplicate-aware Exposure batch. They reinforce that hints should preserve the source's participants, voice, relationships, and phrasing instead of inventing a plausible generic collocation.

| Target     | Context                                                                              | Expected hint                | Observed hint      |
| ---------- | ------------------------------------------------------------------------------------ | ---------------------------- | ------------------ |
| こだわり   | この車の細部に渡るこだわりはさすがですね。                                           | 細部に渡るこだわり           | 細部こだわり       |
| はぐらかす | 曖昧なことを言ってははぐらかし、嘘をついては逃げようとし、あの人はどうしようもない。 | 曖昧なことを言ってはぐらかす | 質問をはぐらかす   |
| 逃げる     | 曖昧なことを言ってははぐらかし、嘘をついては逃げようとし、あの人はどうしようもない。 | 嘘をついて逃げる             | 責任から逃げる     |
| おかず     | おかずが余ったら持って帰ろうと思ったのに、余りそうにない。                           | おかずが余る                 | 夕食のおかず       |
| もしかして | 彼はもしかして、あきれているのではないだろうか。                                     | もしかしてあきれる           | もしかして呆れる   |
| 隙間       | ここに隙間があるということは、欠陥住宅の疑いがある。                                 | ここに隙間がある             | 壁の隙間           |
| 訴える     | 訴えられているだけで必ずしも有罪となるとは限らない。                                 | 訴えられる                   | 裁判で訴える       |
| 方針       | ライバル会社のあの人、まるでうちの会社の方針を知っているかのようだ。                 | 会社の方針                   | 経営方針           |
| 素直       | 彼女はとても素直だが、どことなく儚気なのが気になります。                             | とても素直だ                 | 素直な性格         |
| 気になる   | 彼女はとても素直だが、どことなく儚気なのが気になります。                             | 儚気なのが気になる           | 心配で気になる     |
| 成長       | 日課だからといって、機械的にやっていては成長しません。                               | 機械的では成長しない         | 人の成長           |
| くれぐれも | くれぐれもこの戸を開けてはならない。                                                 | くれぐれも戸を開けない       | くれぐれも注意     |
| 勢い       | あの勢いでお代わりされると、ご飯が足りなくなる恐れがある。                           | あの勢い                     | すごい勢い         |
| シャッター | 頭をぶつけないようにシャッターに気をつけよう。                                       | シャッターに気をつける       | シャッターを下ろす |
| 交流       | EUで交流し合うことは重要だと考えられている。                                         | EUで交流し合う               | 文化交流           |
| 見学       | 明日の見学の際には、身分証明書を持ってきてください。                                 | 明日の見学                   | 施設見学           |
| 譲る       | 飽くまで譲らないタイプの人かと思ったら、かなり柔軟な人でした。                       | 譲らないタイプ               | 意見を譲る         |
| 済む       | もっと早くタバコをやめれば健康問題なしに済んだものを、手遅れになってしまった。       | 健康問題なしに済む           | なしに済む         |
| 相当       | あの体つきからいって、相当筋トレをしているに違いない。                               | 相当筋トレをする             | 相当筋トレする     |
| 解放       | 無事解放されたとしても、その後の精神的なケアが必要です。                             | 無事解放される               | 人質解放           |
| チタン     | チタンは鋼鉄並みの丈夫さだが、はるかに軽量である。                                   | チタンは鋼鉄並み             | チタン製           |

A focused GPT-5.6 replay of the first 20 cases exactly matched only 3 expected hints and reproduced generic inventions such as 質問をはぐらかす, 責任から逃げる, 壁の隙間, and 意見を譲る. It selected the expected senses in 19 cases; for 素直 it selected only sense 1 instead of the expected equivalent senses 1 and 2. This suggests the source-grounding failure is primarily in the shared prompt rather than specific to Gemini.
