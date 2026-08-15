# Captured responses

Every file here is a real response body, saved byte for byte. Nothing here is
hand-written: a hand-written page only contains what its author already thought
of, and the bug these fixtures exist for — a character-set label that the sniff
window cut in half — is exactly the kind of detail nobody writes by hand.

Tests serve these bytes through the fixture transport
(`src/test/fixture-transport.ts`), so the decoding the port does in production
is the decoding the test sees.

| File                            | Captured from                                                    | Status | Why it is kept                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bluray-product-amelie.html.gz` | `https://www.blu-ray.com/movies/Amelie-Blu-ray/7813/`            | 200    | ISO-8859-1 page with accented raw bytes (`Am\xe9lie` in the title) and its `<meta charset>` at byte 2033 — far enough in that a small window loses the label. |
| `bluray-not-found.html`         | `https://www.blu-ray.com/movies/x/2938/`                         | 404    | The site's genuine missing page.                                                                                                                            |
| `bluray-no-such-movie.html`     | `https://www.blu-ray.com/movies/No-Such-Film-Blu-ray/999999999/` | 200    | A missing film the site answers with 200 and a "No such movie" body rather than a 404.                                                                      |

The label's position is what makes the product page worth keeping. It sat past
the original 2048-byte sniff window, which is how the production bug happened:
the window cut the label to `ISO-885`, no decoder accepted it, and the import
failed. Tests cut the captured response at 2048 bytes to hold the label in that
same broken state and assert the import still reads the page correctly.

The product page is stored gzipped only to keep the repository small;
`capturedResponse()` returns the original bytes.

## How they were captured

Captured 15 August 2026 with the headers the direct adapter sends:

```sh
curl -sSL -o <name>.html \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9' \
  -H 'Accept-Language: en-GB,en;q=0.9' \
  '<url>'
gzip -9 <name>.html   # large pages only
```

Re-capture rather than edit. A page that has changed shape is news, and an
edited fixture stops being evidence of anything.
