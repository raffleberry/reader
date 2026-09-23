"""Tests for the text interface (no network, no TTS service)."""
import zipfile

import pytest

from backend import text


def make_epub(path, chapters):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" '
            'media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        items = "".join(
            f'<item id="c{i}" href="ch{i}.xhtml" media-type="application/xhtml+xml"/>'
            for i in range(len(chapters))
        )
        refs = "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"/>'
            f"<manifest>{items}</manifest><spine>{refs}</spine></package>",
        )
        for i, body in enumerate(chapters):
            z.writestr(
                f"OEBPS/ch{i}.xhtml",
                '<html xmlns="http://www.w3.org/1999/xhtml">'
                f"<body>{body}</body></html>",
            )
    return path


def test_epub_sentences(tmp_path):
    raw = make_epub(
        tmp_path / "b.epub",
        [
            "<h1>Title</h1><p>Hello world. Second sentence here!</p>",
            "<p>Last chapter. It ends now.</p>",
        ],
    )
    chapters = text.EpubText().chapters(raw)
    assert len(chapters) == 2
    assert [s.text for s in chapters[0].sentences] == [
        "Title",
        "Hello world.",
        "Second sentence here!",
    ]
    assert chapters[1].sentences[0].chapter == 1
    assert chapters[0].sentences[0].key == "00-0000"


def test_epub_bad_file(tmp_path):
    raw = tmp_path / "b.epub"
    raw.write_bytes(b"nope")
    with pytest.raises(ValueError):
        text.EpubText().chapters(raw)


def test_source_lookup():
    assert text.source_for("epub").name == "epub"
    with pytest.raises(ValueError):
        text.source_for("pdf")


def test_splitter():
    assert text.split_sentences("One. Two! Three?") == ["One.", "Two!", "Three?"]
    assert text.split_sentences("no end") == ["no end"]


def test_load_caches(tmp_path):
    raw = make_epub(tmp_path / "b.epub", ["<p>Hi there.</p>"])
    cache = tmp_path / "s.json"
    first = text.load_chapters("epub", raw, cache)
    assert cache.exists()
    raw.write_bytes(b"changed")  # cache wins over raw file
    second = text.load_chapters("epub", raw, cache)
    assert [s.text for s in second[0].sentences] == [
        s.text for s in first[0].sentences
    ]
