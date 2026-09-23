"""Book text interface: sentences per book, one source per file format.

To add a format (e.g. PDF later): write a class with a ``chapters()``
method, add it to ``SOURCES``, and nothing else changes. TTS in
``voice.py`` only talks to this interface, never to a format directly.
"""
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol


@dataclass
class Sentence:
    key: str      # "00-0003": chapter 00, sentence 03 (safe for URLs/files)
    chapter: int  # spine index, matches frontend chapter order
    href: str     # chapter file inside the book (frontend navigates here)
    text: str     # plain sentence text, whitespace collapsed


@dataclass
class Chapter:
    index: int
    href: str
    sentences: list[Sentence]


class BookText(Protocol):
    """Extract readable sentences from one raw book file."""

    name: str

    def chapters(self, raw: Path) -> list[Chapter]:
        ...


def split_sentences(block: str) -> list[str]:
    """Split one paragraph into sentences. Dumb on purpose; see README."""
    parts = re.split(r"(?<=[.!?…])\s+(?=[A-Z0-9“\"(])", block.strip())
    return [p for p in (s.strip() for s in parts) if p]


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


class EpubText:
    """Sentences from EPUB spine chapters (stdlib zip + xml only)."""

    name = "epub"
    BLOCKS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "div"}

    def chapters(self, raw: Path) -> list[Chapter]:
        try:
            zf = zipfile.ZipFile(raw)
        except Exception as err:
            raise ValueError(f"bad epub: {err}") from err
        with zf:
            opf_path = self._opf_path(zf)
            base = opf_path.rpartition("/")[0]
            root = ET.fromstring(zf.read(opf_path))
            ns = {"opf": "http://www.idpf.org/2007/opf"}
            manifest = {i.get("id"): i.get("href") for i in root.findall("opf:manifest/opf:item", ns)}
            spine = [i.get("idref") for i in root.findall("opf:spine/opf:itemref", ns)]
            out: list[Chapter] = []
            for index, ref in enumerate(spine):
                href = manifest.get(ref, "")
                path = f"{base}/{href}" if base else href
                if href and path in zf.namelist():
                    sents = self._chapter(zf.read(path), index, href)
                    if sents:
                        out.append(Chapter(index, href, sents))
            if not out:
                raise ValueError("no readable text found")
            return out

    def _opf_path(self, zf: zipfile.ZipFile) -> str:
        try:
            container = ET.fromstring(zf.read("META-INF/container.xml"))
        except KeyError as err:
            raise ValueError("not an epub (no container.xml)") from err
        for el in container.iter():
            if _local(el.tag) == "rootfile" and el.get("full-path"):
                return el.get("full-path", "")
        raise ValueError("not an epub (no rootfile)")

    def _chapter(self, data: bytes, index: int, href: str) -> list[Sentence]:
        try:
            root = ET.fromstring(data)
        except ET.ParseError:
            return []
        sents: list[Sentence] = []
        for el in root.iter():
            if _local(el.tag) not in self.BLOCKS:
                continue
            text = " ".join("".join(el.itertext()).split())
            if len(text) < 2:
                continue
            # Skip nested blocks to avoid double counting: only leaf blocks.
            if any(_local(c.tag) in self.BLOCKS for c in el):
                continue
            for sent in split_sentences(text):
                n = len(sents)
                sents.append(Sentence(f"{index:02d}-{n:04d}", index, href, sent))
        return sents


SOURCES: dict[str, BookText] = {"epub": EpubText()}


def source_for(book_format: str) -> BookText:
    """Interface lookup. Raises ValueError for unsupported formats."""
    try:
        return SOURCES[book_format]
    except KeyError as err:
        raise ValueError(f"no text support for .{book_format}") from err


def load_chapters(book_format: str, raw: Path, cache: Path) -> list[Chapter]:
    """Chapters from disk cache, or parse + save on first read."""
    if cache.exists():
        data = json.loads(cache.read_text())
        return [
            Chapter(c["index"], c["href"], [Sentence(**s) for s in c["sentences"]])
            for c in data
        ]
    chapters = source_for(book_format).chapters(raw)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps([asdict(c) for c in chapters], indent=1))
    return chapters
