# Known Sense-Selection Failures

These cases surfaced during the Ankidrone JLPT Tango N1 conversion. They should become eval fixtures when the eval suite grows coverage for sense selection, contextual expression targets, and JMDict granularity failures.

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
