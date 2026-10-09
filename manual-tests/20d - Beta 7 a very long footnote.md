# 20d: beta 7, a very long footnote (2026-10-09)

Claude: a companion to sheet 20, added 2026-10-09. Footnote 1 below runs to about 1,250 characters, past the 1,024 characters Obsidian looks ahead for the next definition, and 100 more footnotes are packed under it one per line, as the plugin writes them. So Obsidian reads every label under footnote 1 as more of its text, until a blank line comes between them (rule E4 in docs/obsidian-reading-rules.md). Beta 6 left such a note as it was and said nothing, so Obsidian showed one footnote holding all the others (hunt cycle 7, Y7). Beta 7 gives footnote 1 the blank line under it. The first fix for that, made during beta 7, had the lint read the note once per footnote for every footnote, about 3 seconds at 100 footnotes and 28 seconds at 200 on the test machine; it was put right before the release (hunt cycle 8, V14), and this sheet checks that the lint stays quick. Automated coverage: the number of readings is pinned in test/hunt/bug-lint-cost-square-under-long-footnote.test.ts, and the blank line the lint puts under the long footnote in test/hunt/bug-label-past-lookahead-not-lazy.test.ts; run `npm test` before this sheet. What is left is how the lint feels on a note this size, and what Reading view shows after it.

Settings: defaults. Undo after the check.

- [ ] Run **Lint footnotes**: it finishes without a stall you can feel (well under a second), and the only change is a blank line between footnote 1's long definition and `[^2]:`. In Reading view, footnote 1 shows its long text alone, and footnotes 2 to 101 each show their own source. One Ctrl+Z takes the blank line out again

The fixture:

Paragraph 1 cites a source.[^1]

Paragraph 2 cites a source.[^2]

Paragraph 3 cites a source.[^3]

Paragraph 4 cites a source.[^4]

Paragraph 5 cites a source.[^5]

Paragraph 6 cites a source.[^6]

Paragraph 7 cites a source.[^7]

Paragraph 8 cites a source.[^8]

Paragraph 9 cites a source.[^9]

Paragraph 10 cites a source.[^10]

Paragraph 11 cites a source.[^11]

Paragraph 12 cites a source.[^12]

Paragraph 13 cites a source.[^13]

Paragraph 14 cites a source.[^14]

Paragraph 15 cites a source.[^15]

Paragraph 16 cites a source.[^16]

Paragraph 17 cites a source.[^17]

Paragraph 18 cites a source.[^18]

Paragraph 19 cites a source.[^19]

Paragraph 20 cites a source.[^20]

Paragraph 21 cites a source.[^21]

Paragraph 22 cites a source.[^22]

Paragraph 23 cites a source.[^23]

Paragraph 24 cites a source.[^24]

Paragraph 25 cites a source.[^25]

Paragraph 26 cites a source.[^26]

Paragraph 27 cites a source.[^27]

Paragraph 28 cites a source.[^28]

Paragraph 29 cites a source.[^29]

Paragraph 30 cites a source.[^30]

Paragraph 31 cites a source.[^31]

Paragraph 32 cites a source.[^32]

Paragraph 33 cites a source.[^33]

Paragraph 34 cites a source.[^34]

Paragraph 35 cites a source.[^35]

Paragraph 36 cites a source.[^36]

Paragraph 37 cites a source.[^37]

Paragraph 38 cites a source.[^38]

Paragraph 39 cites a source.[^39]

Paragraph 40 cites a source.[^40]

Paragraph 41 cites a source.[^41]

Paragraph 42 cites a source.[^42]

Paragraph 43 cites a source.[^43]

Paragraph 44 cites a source.[^44]

Paragraph 45 cites a source.[^45]

Paragraph 46 cites a source.[^46]

Paragraph 47 cites a source.[^47]

Paragraph 48 cites a source.[^48]

Paragraph 49 cites a source.[^49]

Paragraph 50 cites a source.[^50]

Paragraph 51 cites a source.[^51]

Paragraph 52 cites a source.[^52]

Paragraph 53 cites a source.[^53]

Paragraph 54 cites a source.[^54]

Paragraph 55 cites a source.[^55]

Paragraph 56 cites a source.[^56]

Paragraph 57 cites a source.[^57]

Paragraph 58 cites a source.[^58]

Paragraph 59 cites a source.[^59]

Paragraph 60 cites a source.[^60]

Paragraph 61 cites a source.[^61]

Paragraph 62 cites a source.[^62]

Paragraph 63 cites a source.[^63]

Paragraph 64 cites a source.[^64]

Paragraph 65 cites a source.[^65]

Paragraph 66 cites a source.[^66]

Paragraph 67 cites a source.[^67]

Paragraph 68 cites a source.[^68]

Paragraph 69 cites a source.[^69]

Paragraph 70 cites a source.[^70]

Paragraph 71 cites a source.[^71]

Paragraph 72 cites a source.[^72]

Paragraph 73 cites a source.[^73]

Paragraph 74 cites a source.[^74]

Paragraph 75 cites a source.[^75]

Paragraph 76 cites a source.[^76]

Paragraph 77 cites a source.[^77]

Paragraph 78 cites a source.[^78]

Paragraph 79 cites a source.[^79]

Paragraph 80 cites a source.[^80]

Paragraph 81 cites a source.[^81]

Paragraph 82 cites a source.[^82]

Paragraph 83 cites a source.[^83]

Paragraph 84 cites a source.[^84]

Paragraph 85 cites a source.[^85]

Paragraph 86 cites a source.[^86]

Paragraph 87 cites a source.[^87]

Paragraph 88 cites a source.[^88]

Paragraph 89 cites a source.[^89]

Paragraph 90 cites a source.[^90]

Paragraph 91 cites a source.[^91]

Paragraph 92 cites a source.[^92]

Paragraph 93 cites a source.[^93]

Paragraph 94 cites a source.[^94]

Paragraph 95 cites a source.[^95]

Paragraph 96 cites a source.[^96]

Paragraph 97 cites a source.[^97]

Paragraph 98 cites a source.[^98]

Paragraph 99 cites a source.[^99]

Paragraph 100 cites a source.[^100]

Paragraph 101 cites a source.[^101]

[^1]: Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing. Lorem ipsum dolor sit amet, consectetur adipiscing.
[^2]: Source 2, p. 2.
[^3]: Source 3, p. 3.
[^4]: Source 4, p. 4.
[^5]: Source 5, p. 5.
[^6]: Source 6, p. 6.
[^7]: Source 7, p. 7.
[^8]: Source 8, p. 8.
[^9]: Source 9, p. 9.
[^10]: Source 10, p. 10.
[^11]: Source 11, p. 11.
[^12]: Source 12, p. 12.
[^13]: Source 13, p. 13.
[^14]: Source 14, p. 14.
[^15]: Source 15, p. 15.
[^16]: Source 16, p. 16.
[^17]: Source 17, p. 17.
[^18]: Source 18, p. 18.
[^19]: Source 19, p. 19.
[^20]: Source 20, p. 20.
[^21]: Source 21, p. 21.
[^22]: Source 22, p. 22.
[^23]: Source 23, p. 23.
[^24]: Source 24, p. 24.
[^25]: Source 25, p. 25.
[^26]: Source 26, p. 26.
[^27]: Source 27, p. 27.
[^28]: Source 28, p. 28.
[^29]: Source 29, p. 29.
[^30]: Source 30, p. 30.
[^31]: Source 31, p. 31.
[^32]: Source 32, p. 32.
[^33]: Source 33, p. 33.
[^34]: Source 34, p. 34.
[^35]: Source 35, p. 35.
[^36]: Source 36, p. 36.
[^37]: Source 37, p. 37.
[^38]: Source 38, p. 38.
[^39]: Source 39, p. 39.
[^40]: Source 40, p. 40.
[^41]: Source 41, p. 41.
[^42]: Source 42, p. 42.
[^43]: Source 43, p. 43.
[^44]: Source 44, p. 44.
[^45]: Source 45, p. 45.
[^46]: Source 46, p. 46.
[^47]: Source 47, p. 47.
[^48]: Source 48, p. 48.
[^49]: Source 49, p. 49.
[^50]: Source 50, p. 50.
[^51]: Source 51, p. 51.
[^52]: Source 52, p. 52.
[^53]: Source 53, p. 53.
[^54]: Source 54, p. 54.
[^55]: Source 55, p. 55.
[^56]: Source 56, p. 56.
[^57]: Source 57, p. 57.
[^58]: Source 58, p. 58.
[^59]: Source 59, p. 59.
[^60]: Source 60, p. 60.
[^61]: Source 61, p. 61.
[^62]: Source 62, p. 62.
[^63]: Source 63, p. 63.
[^64]: Source 64, p. 64.
[^65]: Source 65, p. 65.
[^66]: Source 66, p. 66.
[^67]: Source 67, p. 67.
[^68]: Source 68, p. 68.
[^69]: Source 69, p. 69.
[^70]: Source 70, p. 70.
[^71]: Source 71, p. 71.
[^72]: Source 72, p. 72.
[^73]: Source 73, p. 73.
[^74]: Source 74, p. 74.
[^75]: Source 75, p. 75.
[^76]: Source 76, p. 76.
[^77]: Source 77, p. 77.
[^78]: Source 78, p. 78.
[^79]: Source 79, p. 79.
[^80]: Source 80, p. 80.
[^81]: Source 81, p. 81.
[^82]: Source 82, p. 82.
[^83]: Source 83, p. 83.
[^84]: Source 84, p. 84.
[^85]: Source 85, p. 85.
[^86]: Source 86, p. 86.
[^87]: Source 87, p. 87.
[^88]: Source 88, p. 88.
[^89]: Source 89, p. 89.
[^90]: Source 90, p. 90.
[^91]: Source 91, p. 91.
[^92]: Source 92, p. 92.
[^93]: Source 93, p. 93.
[^94]: Source 94, p. 94.
[^95]: Source 95, p. 95.
[^96]: Source 96, p. 96.
[^97]: Source 97, p. 97.
[^98]: Source 98, p. 98.
[^99]: Source 99, p. 99.
[^100]: Source 100, p. 100.
[^101]: Source 101, p. 101.
