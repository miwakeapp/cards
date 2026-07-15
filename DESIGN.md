# Miwake Cards Design Doc

## Problem and motivation

At a sufficiently-advanced stage, learning Japanese vocabulary is best done via **vocabulary mining**: encountering unknown (or forgotten) words in context, then creating flashcards for them.

Tools for this exist. However, they are clunky to wire together, and the end product (the vocabulary flashcards produced) are not ideal. The Miwake Cards software suite streamlines the vocabulary mining process, creating an optimal corpus of "Miwake card" flashcards which can be updated and customized over time.

### Principles

- **Anki-centric**: The produced flashcards must be Anki cards. Anki is the best SRS software, which will accompany the user through the entire language-learning journey.

- **Recognition focused**: Miwake cards are designed to quickly test whether the user recognizes the Japanese word, with no or minimal context. They are not meant to serve double-duty as sentence reading practice; they are not testing recall. This design decision also leads to the possibility of creating multiple cards for the same word, with different spellings on the front side. (E.g., if the user wants to recognize both ハサミ and 鋏 as meaning scissors, the user can easily generate two cards for the same word.)

- **Integrated and opinionated**: Unlike [existing solutions](#existing-solutions), this software will be designed as a end-to-end experience, not a series of composable tools. It will be Japanese-specific, which allows it to have custom features that don't make sense in all languages. It will pick winners in terms of dictionaries, flashcard formats, etc.

- **Customizable around the edges**: Despite being opinionated, there will be some room for customization, especially around areas that I've changed my mind on over time, or am not yet sure about. This will be enabled by a flexible data model: e.g., storing extra data in the Anki cards even if it's not displayed by default, or using semantic HTML and relying heavily on CSS for display customization.

- **Sprinkles of AI** ✨: AI enables previously-impossible or -manual steps to be automated to help the experience become seamless and the end products more useful. For example, hint generation, example sentence shortening, or dictionary gloss highlighting.

### Existing solutions

The existing solution I am using is a combination of [Miwake Reader](https://github.com/miwakeapp/ebook-reader) + [Yomitan](https://yomitan.wiki/) + [Jitendex](https://jitendex.org/) + [AnkiConnect](https://ankiweb.net/shared/info/2055492159) + a customized version of the [Animecards template](https://animecards.site/yomichansetup/#connect-yomitan-and-anki).

Although in the fullness of time, a _fully_ integrated project might somehow replace all of these, the priority target for replacement is the Yomitan + Jitendex + Animecards template flow:

- Yomitan is great software, but extremely configurable and requires lots of setup and maintenance (e.g. dictionary updates). Once set up, its flow is mostly-seamless, but can be rough around the edges in, e.g., the sentence-based context extraction, or its treatment of multiple readings for the same word. Overall, it is somewhat too focused on being a generic popup dictionary, and not optimized enough for Japanese sentence mining.

- Jitendex is not well-factored. For some reason they've encoded their dictionary entries as a kind of JSON serialization of HTML, with lots of inline styles, which makes customizing the dictionary entries displayed on cards difficult. They seem to have some logic for merging multiple JMDict entries into a single Jitendex entry, or splitting single JMDict entries into multiple Jitendex entries with redirects, which causes confusion. A cleaner JMDict → semantic HTML-for-Anki flow is a high priority.

- The Animecards flashcard format is like 80% of what I want, but some enhancements—especially via sprinkles of AI ✨—would get us to 100%. Designing the format (notably, the fields) from scratch is an important part of this, e.g., determining the best primary key.

### Out of scope (for now)

- Beginner-focused features. This setup is meant for learners approaching N1-level, who are working to be able to understand arbitrary Japanese content without furigana. It's not clear exactly what features this excludes right now, but, for example, this pushes back against modes where the front of the generated card contains furigana.

- Audio pronunciations on the flashcards. Although my existing setup has these, they are sometimes inaccurate. It'd be nice to fast-follow with this, including possibly ✨ AI-generated audio for the context sentences, but the complexity added via these sidecar files in Anki makes it a later feature.

- Pitch accent information. Including this is a good idea for a followup. But, since the information is not bundled with JMDict, it will take extra work to integrate. The exact format in which to store and display this is also unclear; I've seen different flashcard templates use wildly different presentations. I would also need to deal with cases where it isn't available.

- Other dictionaries besides JMDict. In particular, Japanese–Japanese dictionaries are not in scope. The "monolingual transition" concept is somewhat popular, but also somewhat debated. For now, I side with those who suggest that the goal of a flashcard's back side should be to quickly check your understanding, and for such speed, Japanese–English dictionaries are better.

- Other media besides text in a web browser. Reading novels, or web articles, is enough to keep me busy on mining for a long time. It's possible that the solution we design for novels will mostly work with web-based Netflix subtitles, and if so that could be an early scope expansion. But, e.g., trying to create sound-based flashcards, or OCRing manga, is not a priority for me.

- Recall, or reverse cards. This seems likely to require a very different product, focused around a smaller core set of vocabulary that will come up in speaking or writing, with less emphasis on spellings, and more emphasis on context. I currently believe that attempting to create reverse cards inside a single Anki note is a bad idea, for these reasons.

## Product requirements

### Installation and usage

You install the Miwake Cards browser add-on, via your browser's add-on store. Out of the box, you get a Yomitan-like experience of a popup dictionary, but there is an unobtrusive indicator guiding you to do the Anki setup as well.

The popup dictionary is slightly ✨ smarter than Yomitan in how it prioritizes larger phrases. For example:

> 口が滑って本音を言ってしまった。

Here it should offer [口が滑る](https://takoboto.jp/?w=1640380) ("to let something slip") ahead of the much less specific 滑る.

Clicking on the add-on's dropdowns menu will reveal a "Set up Anki connection" menu item, which guides you to a setup page. That setup page probes for the presence of AnkiConnect and otherwise guides you through any necessary setup for the Anki connection, via a very minimal, non-overwhelming wizard-like interface. There are almost no knobs to configure, as the program is opinionated: e.g., it wants its own deck, it has its own card template, etc. It comes bundled with, and somehow installs, an appropriate Japanese font, to avoid dealing with the always-fiddly per-computer font installation process that Anki requires.

After that setup is complete, the unobtrusive indicator changes color. From now on, the popup dictionary has new controls.

- If the word + spelling + sense used does not exist in the deck, the "add a card" control is present.

- If the word exists in the deck, but not the exact spelling or sense, there is additionally a "see existing cards" control.

- If the word + spelling + sense already exists in the deck as a non-leech, then the previous extracted context is displayed, with the following controls: "replace context", "mark as failed".

- If the word + spelling + sense already exists in the deck but as a leech, then the previous extracted context is displayed, with the following controls: "replace context", "reset to fresh". Some amount of previous review history is also displayed: at a minimum, the date added, and the date suspended.

### Miwake Cards

"Miwake Cards" are an evolution of the [Animecards](https://animecards.site/) Anki note type, aligned with this project's [principles](#principles).

#### Card fields

- **Key**: the card's actual primary key (for disallowing duplicates); it consists of the spelling targeted for recognition + JMDict ID + ✨ sense(s) identified as applicable for this card. (The latter are omitted if all senses apply, or if there is only one sense.) This is the first field in the model so Anki gives it precedence, and the spelling is first so that it's more visible in the card browser.

  - Sample: `ひたと | 1430680 | 2,3`
  - Sample: `相性 | 1586070`

- **Recognition target**: what is shown on the front of the card, containing just the spelling targeted for recognition.

  - For cases where the word is always used in a certain pattern, we can ✨ automatically add the appropriate prefix or suffix. Example: [うつつを抜かす](https://takoboto.jp/?w=2033950) can become 〜にうつつを抜かす in this field, as there is enough information in the dictionary entry to assemble this.

  - This generally never contains furigana, even for cases where the originally mined text used furigana and the word is highly ambiguous. (Such as 番 being either ばん or つがい.) Instead, the hint field can contain appropriate context, including furigana if necessary.

- **Reading** (optional): if the spelling in question contains any Kanji, this field exists and contains the same spelling, but with [mono-ruby](https://www.w3.org/International/questions/qa-ruby.en#mono)-when-possible furigana. Usually it contains the specific reading used in the mined context. If neither the context nor frequency data establishes a dominant reading, it repeats the spelling for each accepted reading, separated by `/`; for example, `明日[あした] / 明日[あす]`. This field uses Anki's `[]`-suffix microsyntax for ruby.

- **Hint** (optional): a sparingly-used disambiguation field for when multiple senses or JMDict entries match the same spelling, such that it would be roughly impossible to tell which was intended without the hint. It is not used when there is only a single JMDict entry for a given spelling and all of its senses are applicable. The hint is a Japanese phrase or fragment that uses the word in extremely-minimal context. AI-generated initially ✨, but users can edit this and the software should not interfere with that.

  - Sample: for sense 2 of [飾り物](https://takoboto.jp/?q=%E9%A3%BE%E3%82%8A%E7%89%A9), a good hint would be "Xさんは飾り物だ": a minimal sentence/sentence fragment that makes it clear we're looking for the sense that applies to a person.

  - Sample: a hint for 番 meaning ["pair (esp. of mated animals), brace, couple"](https://takoboto.jp/?w=2199920) instead of ["number (in a series)"](https://takoboto.jp/?w=2022640) could be "魂の番".

- **Full context**: the original full context sentence(s) in which the term was encountered, no matter how long it was. Uses `<mark>` for the term in question.

  - This is extracted from the content being read ✨ automatically. It will at least be a single full sentence, but if the AI judges that more context is necessary, it can expand to two or three sentences. (See [expanding unhelpful context](#expanding-unhelpful-context).)

  - If the original context included furigana, they are preserved (although translated to Anki's `[]`-suffix microsyntax). Additionally, many books substitute full-sized kana in place of small kana in furigana position (as a kind of poor-man's `text-transform: full-size-kana`); the software corrects this back as part of the extraction and translation.

  - Sample: `これまでずっと<mark>殺伐</mark>とした最前線でのみ暮らし、ＳＡＯを──いや 全[すべ]てのＭＭＯＲＰＧをリソースの奪い合いとしか理解していなかった俺にとって、彼らのやり取りは 微[ほほ] 笑[え]ましく、そして 眩[まぶ]しいものに映った。`

- **Minimized context** (optional): a trimmed-by-AI ✨ version of the context sentence(s) which preserves the context, but reduces redundant clauses or emphasis elements so as to make it easier to read when quickly doing flashcards. The result is still a well-formed full Japanese sentence, even if originally the word was located in, e.g., a descriptive clause.

  If the original full context was short enough as-is, this is omitted.

  - Sample: the above becomes `これまでずっと<mark>殺伐</mark>とした最前線でのみ暮らしていた。`

- **Dictionary entry**: a semantic-HTML version of the specified JMDict entry. (Discussed in detail [later](#semantic-html-jmdict).) Importantly, this is not specific to the card in question, so it can be easily updated later as JMDict updates.

- **Source** (optional): the source from which this word was found. This field generally will contain HTML, at least identifying the language of the source's name, and additionally giving a link to it when available. For example:

  - `<span lang="en">GPT 5.5 Thinking</span>`, for an AI-generated example sentence

  - `『<cite lang="ja">虐殺器官</cite>』`, for a Japanese book title

  - `「<a lang="ja" href="https://news.web.nhk/newsweb/na/na-k10015175781000"><cite>羽田空港 C滑走路で路面剥離 閉鎖し修復作業 再開午後6時ごろ</cite></a>」`, for a Japanese article title

  - `<a lang="en" href="https://tatoeba.org/en/sentences/show/76039">Tatoeba</a>`, for sentence from the Tatoeba project

  When mining in a browser extension, we can anticipate using heuristics and AI ✨ to trim and improve the `<title>` of the page being mined, e.g. `ソードアート・オンライン2 アインクラッド (電撃文庫) | Miwake Reader` becomes `『<cite lang="ja">ソードアート・オンライン2 アインクラッド</cite>』`.

#### The displayed cards

The core data model discussed above forms the foundation for displaying Miwake cards with some amount of flexibility and customizability. A default display will be provided, but it might evolve over time as my opinions on the best flashcard format change, or it can be customized by advanced users.

The default display uses the [Anki templating language](https://docs.ankiweb.net/templates/intro.html) to display a simple front side with the **Word** field, and the **Hint** field if present. The back side contains the **Reading** (or a repeat of the **Word** if there is no **Reading** field), the **Dictionary entry**, and the **Minimized context sentence**. The **Full context sentence** is hidden by default but can be shown with a disclosure button. The **Source** field is included when present.

The HTML used for displaying these will be highly semantic, allowing customization with CSS. The default styling will work with both dark and light modes, keying off of Anki's `.night-mode` selector. (TODO or should we use `@media`? What are the tradeoffs, in modern Anki?)

The back-side HTML will contain additional JavaScript which customizes the card display in ways that cannot be achieved easily with Anki templates or CSS. Most notably, it will dim (or perhaps hide) non-applicable senses shown in the dictionary entry.

See [below](#anki-templates) for implementation discussions.

TODO: the given setup doesn't seem to work well if we want slightly more hints on the front, e.g., the part of speech. Is that an issue? They might be especially useful for leeches.

#### Tags

TODO: do we want to include any information in the Anki card's tags? We could consider storing metadata like JMDict version, Miwake Cards version, etc. However, this would have the unfortunate side effect of cluttering up the user's Anki card browser. Perhaps HTML comments or a dedicated metadata field are better for such information, if it is useful? Are there any tags that would be actually useful for our users?

### Maintenance

In addition to providing tools for creating cards, this project distinguishes itself by also helping with card management and maintenance.

#### Keeping JMDict updated

The [JMDict](https://www.edrdg.org/jmdict/j_jmdict.html) project sees almost-daily updates, and in the course of my studies I've found these to be significant. For example, when first encountering the word [つんつん](https://takoboto.jp/?w=1008230), the three-month-old copy of JMDict/Jitendex that I had last downloaded through the Yomitan UI was missing the sense currently defined as "spiky (esp. of a hairstyle), sticking up straight (e.g. of plant stems)"—which is how the word was being used in the novel I was reading. Checking the online dictionary found that it had been recently added.

As such, we want to ensure that the tooling is always using the freshest copy of JMDict it can. The download of this dictionary should happen automatically, probably via an independently-run process, but perhaps via the browser add-on update cycle. Of course, such updates need to be seamless so that the new dictionary is only swapped in once ready. The JMDict release currently in use will be identified clearly in the settings UI.

#### Updating existing cards for JMDict updates

The trickier part of maintenance is updating existing cards in light of JMDict updates which could make the more accurate.

Our [card data model](#card-fields) helps with this somewhat, by locating the dictionary entry separately from the rest of the card. But the fact that our cards highlight particular senses, and include hints conditionally depending on the contents of the dictionary entry, make such updates nontrivial. We'll need to use ✨ AI.

By default, this update process will be manual. A button from within the add-on UI will:

1. Scan the user's collection.
1. Automatically perform "trivial" updates. For now, trivial updates are defined as cases where the dictionary entry has one sense both in old and new versions. These will be displayed to the user for one-click acceptance.
1. Create a set of recommended updates for manual review and acceptance, which can be done either one-by-one or in batch.
   - These recommended updates are derived by asking the AI. Roughly, `Entry before: <...>; Hint before: <...>; Applicable senses before: <...>; Entry after: <...>. Produce a new hint, or use the existing one if it still makes sense. Produce a new set of applicable senses.`
1. Create a set of exceptional cases where the AI cannot derive a good suggestion. Examples could include (but are not limited to):
   - If the spelling under review is removed from that dictionary entry.
   - If the dictionary entry was deleted.
   - If the AI judges that none of the new senses are applicable.

   Actions for these entries could include deleting the corresponding card, or permanently marking it as not managed by this software. (The latter would probably use card tags.)

The UI for reviewing and accepting these updates needs to be highly optimized ease-of-use and for scannability (e.g., vertical space use).

#### Leech management

An important part of long-term vocabulary deck curation, which Anki provides no real help with, is leech management.

The [leech settings](https://docs.ankiweb.net/leeches.html#leeches) for the deck this software creates will be left at the Anki default of suspending after 8. But this software can provide better tooling for what happens to the leeches afterward.

The exact shape of this is not clear, but I envision some sort of dashboard showing all the leech cards, as well as their study timeline (e.g., when first studied, when marked as a leech). For each card, there would be a variety of actions to take to improve the leech and then reintroduce it into the deck:

- Add a hint
- Promote the context sentence fragment to the front of the card
- Just reset with no changes

### Summary: which fields are editable by the user?

Given this flow, most card fields can be modified by the user, if they find it enhances the card. The exceptions are:

- **Key**: this is core to the data model.
- **Dictionary entry**: modifications to this will be overwritten in future dictionary updates.
- **Hint**: modifications to this _can_ be overridden in future dictionary updates.

Notably, the **Word** field _can_ be modified, since only the **Key** field is used by the maintenance and curation parts of the software. For example, if a user finds [然](https://takoboto.jp/?w=1394690) to not be sufficiently helpful and would prefer ～然とする, they can modify the card as such.

The **Hint** field not being freely editable is a bit suboptimal, but it might be fine to handle this by having sufficiently-clear UI during the [card update process](#updating-existing-cards-for-jmdict-updates), e.g., never overwriting the hint by default.

## Design details

### Anki card fields

It was considered to include separate fields for each of the key's components (i.e., JMDict ID and applicable senses), in addition to including them in the key. This would make it easier to insert them into the template, e.g. with code such as

```handlebars
<a href="https://takoboto.jp/?w={{JMDict ID}}">{{Word}}</a>
```

or

```handlebars
<script>
let applicableSenses = "{{Applicable senses}}".split(",");
</script>
```

For now, we omit these:

- Reducing the number of fields shown in the Anki card browser creates a better user experience. We don't want these cards to be write-only.

- They can easily be backfilled later, by automated maintenance tooling, if necessary.

- JavaScript can parse the more-complex key fields by itself.

### Semantic HTML JMDict

A core part of this project is the dictionary entries displayed on the back of each card. Unlike Jitendex, we want these to be created using semantic HTML that can easily be styled in different ways, including nontrivial customization such as hiding redundant or unhelpful parts of the dictionary entry. The HTML also needs to be relatively compact and easy to understand. (Again, unlike Jitendex.)

In terms of inspiration for what types of styling should be possible, popular JMDict displays we can compare to include [Takoboto](https://takoboto.jp/) (my favorite), [Jisho.org](https://jisho.org/) (anecdotally popular), [WWWJDIC](https://www.edrdg.org/cgi-bin/wwwjdic/wwwjdic) (the official JMDict frontend), [Tangorin](https://tangorin.com/), and [Lorenzi's Jisho](https://jisho.hlorenzi.com/).

Some specific design decisions in our output:

- Pull out shared annotations to the top level. For example, all senses of [大小](https://takoboto.jp/?w=1414110) are nouns, so we create a top-level `<ul class="part-of-speech"><li>noun</li></ul>` and omit that information from each sense's `<li>`.

- Omit empty information. For example, most of the words below do not have any values for JMDict's per-sense fields like `"antonym"`, `"field"`, `"dialect"`, `"misc"`, etc. We do not emit empty `<ul>`s for those since doing so clutters up the output unnecessarily.

- Sidestep the problem of matching up kana and kanji. Like Takoboto but unlike Jisho.org, we simply list all kanji and kana readings, and lose the information contained in JMDict about which kana readings go with which Kanji. This can get complicated (see, e.g., [Jisho.org for 松明](https://jisho.org/word/%E6%9D%BE%E6%98%8E)) and in our framework is superseded by the display of the spelling being quizzed (the **Reading** field), which is separated from the dictionary entry. _That_ spelling will have precisely-placed kana, and will potentially use the JMDict information (plus ✨ AI) in assembling it.

- Always mark up Japanese with `lang="ja"`. This includes inside tags like `<span lang="ja">の</span>-adj`. This allows custom Japanese fonts separate from the rest of the dictionary entry, and is generally good hygiene.

- Include human-readable text content (e.g. "する verb", "intransitive", "rare"), but annotate the containing elements with their raw JMDict data (e.g. `vs`, `vi`, `rK`) using the `class=""` attribute. This allows CSS to selectively hide certain tags. For example, I find the `uk` ("usually kana") tag to be useless information for the sorts of flashcards we are creating, which are focused on a specific spelling on the front side.

- Use lists for things that are lists in the JMDict data. The case where this is a bit controversial is the glosses within a sense. Most dictionary displays output each gloss as one string, with senses delimited by semicolons or commas. We intend to reproduce this display using CSS generated content, e.g., `.glosses > li::after { content: "; " }`. However, this has the notable drawback that CSS generated content is not selectable, so copying and pasting from the back side of these Anki cards will give unhelpful results.

- Nicely indent and format the HTML. This makes writing the CSS a bit trickier, as it introduces inter-element whitespace. But, it helps avoid the feeling that one's Anki deck contains unintelligible blobs. (This might be revisited in the future, as the dictionary entry field is intended to be read-only anyway...)

TODO Discuss ✨ removal of en-GB redundancy

For examples, including tricky cases like multiple readings, multiple senses, etc., see the [checked-in JMDict entries](./data/resources/jmdict/entries/) and [resulting HTML snapshots](./jmdict_to_html/test/__snapshots__/render_entry_test.ts.snap).

### Reading field and furigana placement

The **Reading** field of the card contains the reading or readings that the user should accept for the recognition target and optional context hint. Usually the mined context selects one specific reading. When it does not, frequency evidence determines whether one reading is dominant or several should be listed, instead of turning an arbitrary choice into part of the test.

In some cases, the reading will come directly from the context sentence: for example, rare kanji often get their reading spelled out in the source book. But in most cases, we need to identify the valid reading or readings from the JMDict entry. Deterministic restrictions, including senses' `appliesToKana` and readings' `appliesToKanji`, narrow the candidates first. AI ✨ can then use the full JSON entry and context to choose between the remaining candidates.

Once we have the front recognition target and its reading or readings, precise furigana placement for each is done using the [Lorenzi's Jisho](https://jisho.hlorenzi.com/) furigana file. The resulting association of furigana over the correct kanji helps the user reinforce kanji readings organically, over the course of many reviews.

Using the [JmdictFurigana project](https://github.com/Doublevil/JmdictFurigana) was considered, but some quick smoke-testing revealed [it's missing at least one obvious case](https://github.com/Doublevil/JmdictFurigana/issues/25), so I lost confidence in the project.

Furigana placement involves lookups in large data tables. The current design pre-computes a ~60 MiB JSON file, loads it lazily the first time a kanji reading is formatted, and retains it in memory for fast subsequent lookups. This avoids the cost for consumers that never format readings, but adds about a second to the first lookup and retains the full table afterward. If I want to optimize this in the future, we can consider strategies like sharding by JMDict ID prefix or similar.

### Anki templates

See [`anki_updater_prototype/`](./anki_updater_prototype/)'s HTML and CSS files.

The JavaScript on the back side of the card is responsible for:

- Handling the disclosure button for showing the full context in place of the minimized context.
- Adding the `relevant` CSS class to sense `<li>`s that are relevant (which is all of them, by default).

The CSS in [`styles_prefix.css`](./anki_updater_prototype/shared/miwake_model/styles_prefix.css) is meant to be combined with one of the CSS files for the semantic HTML JMDict entries, as a prefix that handles the rest of the card.

For now, we inline the JavaScript onto the back side of the card, and the styles into the styles part of the card. It appears that [dividing up code into external files is quite intricate](https://forums.ankiweb.net/t/how-to-include-external-files-in-your-template-js-css-etc-guide/11719), so we avoid that.

## Roadmap and checkpoints

I'll build this software in checkpoints, allowing some user testing along the way.

### JMDict to HTML

The JMDict to HTML project takes as input a JMDict dictionary entry, in JSON format, and produces semantic HTML. It also comes bundled with a few CSS files and a small previewer app to validate that the produced dictionary entries are fit to purpose.

### Semi-manual card regeneration

Using my existing corpus of Animecards, I can use manual AI ✨ prompting (e.g. in Claude Code) to convert some of my existing leech cards into new Miwake Cards.

The Animecards contain word, reading, dictionary entry, sentence, and hint. These can be converted into the [target fields](#card-fields) with some ✨ smarts; the tricky parts are:

- identifying which dictionary sense is applicable in the sentence;
- adding a disambiguating hint if necessary;
- adding precisely-placed furigana to the reading field;
- trimming down the existing context into minimal context.

The AI can create these new cards using the AnkiConnect API.

This allows field-testing the Miwake Card format, both in the Anki previewer and in real reviews.

### Reading generation

While doing the semi-manual workflow, I noticed that precisely placing furigana using an LLM was error-prone. Since we want to do this [using a non-AI workflow](#reading-field-and-furigana-placement) anyway, I'll code up a subroutine for generating Anki-style readings from (kanji, reading) pairs.

### Semi-automated card regeneration

The next step is to improve the automation of the above process, in a way that generates code which will be useful in the long term.

The key insight here is in the final Miwake product, the card-generation process's input will be:

- Context
  - This will generally be larger than a sentence (e.g., a page of text?) in the final product, since the final product needs to intelligently determine the appropriate amount of context and minimal context.
  - The format will be HTML.
  - It will include furigana (as `<ruby>`), sometimes even over the recognition target.
- The recognition target
  - This will be identified as a JMDict entry that the user picks out from the Miwake popover interface.
- Source and source URL

My existing Animecards contain at least the context and recognition target, and so if we build a tool that takes these inputs as part of the eventual full Miwake pipeline, it can be repurposed to automate the leech regeneration process.

There's a small wrinkle here where my OCD would be best satisfied by some tweaks:

- The existing Animecards contain, in many cases, truncated context, as I was trying to reproduce the minimized context experience within that workflow. It'd be ideal to search out the original full context.
- Relatedly, the existing Animecards do not contain source information.

Subsequent revisions of this semi-automated card generation tool could work to trawl through epub files and fix these deficiencies. The full-context extraction might even provide good testing for the eventual Miwake experience of identifying the correct full context. (E.g. in cases where it's more than a single sentence.) However, that code would largely be throwaway, since it would not contribute to the final Miwake product.

TODO: continue roadmap.

## Tricky cases

Creating a card requires choosing several related but independent things: the recognition target, a JMDict entry, the applicable senses within that entry, the reading used in context, and enough context to justify those choices. Treating these as a single "dictionary result" is the source of many bad cards.

The cases below cover each point at which the simple one-spelling, one-entry, one-sense, one-reading path can branch. Before using AI, the program should apply JMDict's spelling and reading restrictions to eliminate structurally impossible combinations. AI should resolve the remaining contextual ambiguity. When the available data is still insufficient, the program should make its best supported choice and flag the card as suboptimal instead of adding an interactive clarification step to the mining flow.

| Ambiguity                               | How the card represents the choice                                          |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Several senses in one entry             | Sense numbers in the **Key**, plus a **Hint** when disambiguation is useful |
| Several entries for one spelling        | JMDict ID in the **Key**, plus a required **Hint**                          |
| Several spellings for one entry         | Recognition target at the start of the **Key**                              |
| Several readings for one spelling       | Dominant reading, or multiple forms in **Reading**                          |
| Several possible word boundaries        | Prefer the longest JMDict expression supported by the context               |
| Insufficient dictionary data or context | Best supported choice, plus a persistent suboptimal-card flag               |

### Selecting senses within one entry

#### Only some senses apply

Consider [ひたと](https://takoboto.jp/?w=1430680) in:

> ヒースクリフはひたとこちらを見据えた。

In this sentence it means sense 2, "directly (e.g. staring)". Sense 1, "close to", does not apply, and sense 3, "suddenly (e.g. stopping)", is distant enough that it would be learned better from a separate encounter.

The program should therefore produce a key such as `ひたと | 1430680 | 2` and a hint such as ひたと見据える.

Several, but not all, senses can also fit. An example is [見込み](https://takoboto.jp/?w=1604480) in:

> 来年3月に学校を卒業する見込みだ。

Here, both sense 1, "possibility; likelihood", and sense 2, "expectation; forecast", describe the usage, while sense 3, "side of a structural member", does not. The key is therefore `見込み | 1604480 | 1,2`. In general, the card should store the complete applicable subset, not only a single "best" sense.

#### All senses apply

Consider [がつがつ](https://takoboto.jp/?w=1003240) in:

> セックスにがつがつしている男たちにいい加減食傷しているのだ。

This can be understood through either the literal "voraciously" sense or the figurative "greedily; eagerly" sense. Forcing the usage into only one of them would add a distinction that the sentence does not make. The card should use the short all-senses key, `がつがつ | 1003240`, and omit the hint.

Another example is where the different senses are just grammatical variations of each other, such as [くよくよ](https://takoboto.jp/?w=1003930) in:

> 失敗は誰にでもあるのだから、いつまでもくよくよしていないで、元気を出してよ。

Here, JMDict separates the verbal sense "to fret; to brood" from the adverbial sense "worriedly; constantly fretting". The くよくよして construction does not create a useful semantic distinction between them, so the appropriate key is `くよくよ | 1003930`, with no hint.

#### One sense combines distinct usages

Sometimes a JMDict sense covers multiple associations that deserve separate cards. Before [this accepted change I submitted to 甘い](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1213400.1~2375061), one sense combined being indulgent or lenient toward someone with having naive or overly optimistic thinking. A card for 子供に甘い and one for 考えが甘い could both target that sense accurately, but they would receive the same key even though they teach different associations.

Until JMDict is corrected, the program should target the broad sense, generate a hint that identifies the intended association, and flag the card as suboptimal because the sense is too broad. It must not invent finer-grained sense numbers. The product should encourage the user to submit a JMDict correction; after a later release splits the sense, normal card maintenance can retarget the card, update its key, and clear the flag.

#### No sense accurately describes the usage

A different problem occurs when the entry is correct but none of its senses adequately describes the encountered usage. Before [this accepted change I submitted to 不味い](https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=1495000.1~2375128), JMDict had no interjection sense for contexts such as:

> 不味い。彼との約束を忘れてた。

The adjective sense "awkward; problematic; troublesome" was related, but it did not accurately represent the standalone "oh no; this is bad" interjection. In this situation, the program should use the closest existing sense only as a provisional anchor and flag the card as having no accurate JMDict sense. The hint and context can preserve the intended usage, but they cannot make the dictionary-backed sense selection correct.

As in the too-broad-sense case, the product should encourage a JMDict correction while keeping the card managed. Once a later release adds the missing sense, normal card maintenance can retarget the card to it, update the key and dictionary entry, and clear the flag.

### Selecting between multiple dictionary entries

Different JMDict entries can share the exact same spelling. [はさみ meaning pincers or claws](https://takoboto.jp/?w=2029540) and [はさみ meaning scissors or a hole punch](https://takoboto.jp/?w=1573820) are separate entries, so the JMDict ID keeps their keys distinct. The popup should show them separately and rank them using the context; the result the user selects supplies the intended entry without an additional clarification step.

Every card in this situation requires a hint, such as 蟹のはさみ or はさみで切る, even when no conflicting card currently exists in the deck. Otherwise the first card becomes unfair as soon as the second is added. This requirement is nonlocal: card creation must search the whole JMDict for other entries containing the same recognition target before deciding whether a hint is optional.

[包む](https://takoboto.jp/?w=1584060), usually つつむ, and [包む](https://takoboto.jp/?w=2831360), read くるむ, are harder: the entries overlap in both spelling and meaning. Context or source furigana may identify the entry, but some unannotated uses will remain ambiguous. These cards still always require a hint. If a semantic hint cannot distinguish them, the hint must include the reading; this is a justified exception to the general preference against front-side furigana.

### Selecting a spelling within one entry

One JMDict entry can contain several kanji and kana spellings. This does not require separate sense selection: the exact spelling the user chose becomes the recognition target, so cards for 鋏 and ハサミ can share entry 1573820 and the same applicable senses while remaining distinct cards. JMDict's `appliesToKanji` and `appliesToKana` restrictions should filter out senses and readings that are invalid for the selected spelling before contextual inference begins.

### Selecting a reading within one entry

#### The context selects one reading

Reading restrictions can sometimes settle the question mechanically. For [開眼](https://takoboto.jp/?w=1202590), the sense "gaining or restoring eyesight" is restricted to かいがん, while the Buddhist statue-consecration sense is restricted to かいげん. Once either of those senses is known, the incompatible reading should not be presented as an equally plausible answer.

Source furigana is even stronger evidence and should be preserved. Otherwise, the program can infer a reading from the selected sense, register, surrounding words, and frequency data. A choice that remains poorly supported should be recorded with a suboptimal-card flag rather than adding a confirmation step.

[異名](https://takoboto.jp/?w=1158110) illustrates why sense and reading selection must remain separate:

> そこへ、《閃光》の異名に恥じない連続攻撃が容赦なく加えられた。

The applicable sense is 1, "another name; nickname; alias", not the biology sense "synonym". JMDict restricts the latter sense to いめい, but it does _not_ restrict いめい to that sense: sense 1 permits both いみょう and いめい. Thus the sense selection alone cannot prove the reading. In the absence of source furigana, いみょう is a reasonable choice because JMDict marks it as the common reading, but that remains an inference.

#### More than one reading is acceptable

Some spellings have multiple readings without a corresponding difference in meaning. [明日](https://takoboto.jp/?w=1584660), for example, can mean "tomorrow" as あした, あす, or みょうにち, with register and context influencing the natural choice. These alternatives should not produce duplicate cards: the front and meaning being learned are the same.

The decision order is:

1. If the source contains furigana, record that encountered reading.
1. Otherwise, eliminate readings incompatible with the selected spelling, senses, or context.
1. Compare the remaining readings using corpus frequency data. If one accounts for more than 70% of observed use, make it the sole required reading. Otherwise, include each reading with material usage—provisionally at least 5%—in descending frequency order.

The [EDRDG Google n-gram lookup](https://www.edrdg.org/~jwb/ngramcounts.html), for example, reports 67.3% for あした, 32.6% for あす, and 0.1% for みょうにち when those kana forms are compared. Under this policy, an unannotated, register-neutral occurrence becomes `明日[あした] / 明日[あす]`: neither of the first two readings dominates, while みょうにち is too rare to require without contextual evidence. The n-gram data is a useful proxy rather than unquestionable truth—it comes from a 2007 web corpus and cannot always distinguish how a kanji spelling was read—so newer corpora and explicit source evidence take precedence.

### Selecting the right word boundary

A sentence can contain a valid long expression and one or more valid component words. For example:

> 口が滑って本音を言ってしまった。

Selecting plain [滑る](https://takoboto.jp/?w=1208640) loses the idiomatic meaning; the recognition target should be [口が滑る](https://takoboto.jp/?w=1640380). Likewise:

> 手が滑って料理を落とした。

This should resolve to [手が滑る](https://takoboto.jp/?w=2399520), not the same generic verb.

The popup should therefore search for all matches beginning at the selected text and rank the longest contextually valid expression first. Length is a preference, not an absolute rule: a longer string that does not match the sentence's grammar or meaning must not hide the correct shorter entry.

### Matching dictionary forms to inflected text

The recognition target is normally a dictionary form, but the literal text in the source may be conjugated, inflected, or derived. For example, a card for 後ろめたい may come from 後ろめたさ, and a card for 頭をよぎる may come from 頭をよぎった. The program should keep the dictionary form as the recognition target and key, while separately identifying the exact `targetInContext` so it can mark the correct source substring.

This matching must account for ordinary conjugation and derivation without swallowing unrelated auxiliaries or nearby text. The clicked occurrence normally identifies which source substring is being mined; if that is still ambiguous, the program should use its best match and flag the card as suboptimal rather than interrupting the flow.

### Expanding unhelpful context

Consider [途方にくれる](https://takoboto.jp/?w=1854560) in the sentence:

> 途方にくれた。

This contains too little information to remind the learner what prompted the reaction. A representative surrounding passage might instead look like:

> 終電はもう出た後で、タクシーに乗るお金もなかった。途方にくれた。

The context extractor should start with the containing sentence, then pull in adjacent sentences until pronouns, omitted subjects, reactions, and causal links are understandable, normally stopping after two or three sentences. The expanded passage belongs in **Full context**. The minimizer can then produce a compact, self-contained version such as 終電はもう出た後でタクシー代もなく、途方にくれた。 for routine review. It must not invent facts that are absent from the available source. If the surrounding text still does not resolve the ambiguity, the card should be added to a suboptimal-card list with an "insufficient source context" reason. That flag is not automatically fixable, since no later dictionary update can restore context that was never captured.
