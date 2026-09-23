from backend import books


def test_kind_ok():
    assert books.kind_of("a.epub") == "epub"
    assert books.kind_of("B.EPUB") == "epub"


def test_kind_bad():
    assert books.kind_of("a.pdf") == ""
    assert books.kind_of("a.txt") == ""
    assert books.kind_of("noext") == ""


def test_add_rejects_non_epub(tmp_path, monkeypatch):
    use_tmp(tmp_path, monkeypatch)
    for name in ("a.pdf", "a.txt"):
        try:
            books.add(name, b"PK\x03\x04junk")
        except ValueError as err:
            assert "only .epub" in str(err)
        else:
            raise AssertionError(f"expected ValueError for {name}")


def test_add_rejects_fake_epub(tmp_path, monkeypatch):
    use_tmp(tmp_path, monkeypatch)
    try:
        books.add("a.epub", b"not a zip")
    except ValueError as err:
        assert "valid .epub" in str(err)
    else:
        raise AssertionError("expected ValueError")


def test_add_roundtrip(tmp_path, monkeypatch):
    use_tmp(tmp_path, monkeypatch)
    book = books.add("my book.epub", b"PK\x03\x04fake-zip-bytes")
    assert book["title"] == "my book"
    assert book["format"] == "epub"
    assert books.raw_path(book).exists()
    assert books.get(book["id"]) == book
    assert books.drop(book["id"]) is True
    assert books.get(book["id"]) is None


def use_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(books.store, "UPLOADS", tmp_path / "u")
    monkeypatch.setattr(books.store, "CACHE", tmp_path / "c")
    monkeypatch.setattr(books.store, "META", tmp_path / "m.json")
