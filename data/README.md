# Data

Data access and generation package for Miwake. Checked resources live under `resources/`; large downloads, derived databases, and test scratch data live under the ignored `generated/` directory.

## Checked-in JMDict data

The full JMDict and furigana datasets are large, frequently updated runtime resources, so they remain local under `generated/`. Tests, few-shot examples, evals, and the dictionary preview need only a small, stable subset under `resources/jmdict/`. Checking in that subset makes a clean checkout and CI self-contained, deterministic, and independent of whatever full datasets a developer happens to have locally.

Download the latest JMDict and furigana data and rebuild the checked-in subset with:

```sh
deno task --cwd data update:jmdict
```

`update:jmdict` downloads its two independent inputs in parallel and then runs `build:jmdict`. The build refreshes the selected entries and tag descriptions, records the source revision in `resources/jmdict/snapshot.json`, and reduces the full furigana data to the relevant test records. Run `build:jmdict` directly to rebuild from existing local inputs. Commit the resulting checked-in resource changes together.

The JMDict snapshot is derived from [jmdict-simplified](https://github.com/scriptin/jmdict-simplified), which packages the Electronic Dictionary Research and Development Group's JMDict data under the [Creative Commons Attribution-ShareAlike 4.0 license](https://github.com/scriptin/jmdict-simplified/blob/master/LICENSE.txt). The small checked-in furigana fixture is extracted from [Lorenzi's Jisho](https://jisho.hlorenzi.com/); the full download remains local.

## Rarity resources

Download the corpus inputs and build the resources used by `rarity_score`:

```sh
deno task --cwd data update:rarity
```

Run `build:rarity` directly to rebuild from existing local inputs. The `download:*`, `build:*`, and `update:*` task families can also be run as quoted wildcard patterns.

The primary source is the National Institute for Japanese Language and Linguistics (2020) [NWJC surface 1-gram data](https://github.com/masayu-a/NWJC/blob/master/NWJC-n-gram/00README.md), using the 2014-Q4 corpus data and licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Frequencies are normalized against the sum of counts in the downloaded file.

The generated resources also include the National Institute for Japanese Language and Linguistics, Center for Corpus Development, [BCCWJ LUW2 frequency list](https://repository.ninjal.ac.jp/records/3231), Version 1.1, licensed under [CC BY-NC-ND 3.0](https://creativecommons.org/licenses/by-nc-nd/3.0/).

Like the JMDict updater, the NWJC download task follows the current upstream file instead of pinning a source revision. The BCCWJ download uses the checksummed Version 1.1 artifact above. The resource builder validates both downloaded schemas before replacing the existing database. Downloaded source data and generated lookup resources remain local and are not committed.

## ZIP extraction

All project ZIP downloads use [`fflate`](https://github.com/101arrowz/fflate). We originally used [`@quentinadam/zip` 0.1.17](https://jsr.io/@quentinadam/zip/0.1.17/src/zip.ts), but it rejected the valid NWJC surface 1-gram archive before decompression. Its reader asserts that the ZIP local-header and central-directory extra fields are byte-for-byte identical; the ZIP format permits them to differ, and the NWJC archive stores different timestamp metadata in the two locations. Standard ZIP tooling and `fflate` both validate and extract the archive successfully.

Using one extractor for NWJC, BCCWJ, and JMDict avoids retaining a second ZIP implementation with this known compatibility limitation.
