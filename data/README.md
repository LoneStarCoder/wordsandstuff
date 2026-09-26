# Word list

- `enable1.txt` — the ENABLE2K word list (Enhanced North American Benchmark
  Lexicon), released into the public domain. 172,823 words.
- `supplement.txt` — a short list of modern words (qi, za, email, emoji, …)
  added on top.

`npm run build` merges them, drops words longer than 15 letters (they can
never fit on the board), and packs the result into a compact DAWG
(`dist/a/dict.<hash>.bin`) that both the server and the in-browser bot read
directly.
