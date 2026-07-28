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
