from server import (
    _address_candidate,
    _coordinates,
    _geocode_queries,
    in_floresti,
    is_render_local_mongo,
    normalize_street,
)


def test_render_local_mongo_is_ignored_only_on_render(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    assert is_render_local_mongo("mongodb://localhost:27017/navigator")
    assert is_render_local_mongo("mongodb://127.0.0.1:27017/navigator")
    assert not is_render_local_mongo("mongodb+srv://cluster.example.net/navigator")
    monkeypatch.setenv("RENDER", "false")
    assert not is_render_local_mongo("mongodb://localhost:27017/navigator")


def test_geocode_queries_include_victoriei_variants():
    queries = _geocode_queries("bd. Victoriei", "4/a")
    assert any("Bulevardul Victoriei" in query for query in queries)
    assert all("Florești, Moldova" in query for query in queries)


def test_coordinates_accepts_geojson_order_and_checks_area():
    assert _coordinates({"geometry": {"coordinates": [28.29, 47.89]}}) == (47.89, 28.29)
    assert in_floresti(47.89, 28.29)
    assert not in_floresti(46.0, 28.0)


def test_exact_house_geocode_requires_house_street_and_floresti():
    feature = {
        "properties": {"housenumber": "4/a", "street": "Bulevardul Victoriei", "city": "Florești"},
        "geometry": {"coordinates": [28.29854, 47.89286]},
    }
    assert _address_candidate(feature, "bd. Victoriei", "4/a") == (47.89286, 28.29854)
    assert _address_candidate(feature, "bd. Victoriei", "4") is None
    feature["properties"]["city"] = "Bălți"
    assert _address_candidate(feature, "bd. Victoriei", "4/a") is None


def test_boulevard_alias_normalizes():
    assert normalize_street("bd. Victoriei") == normalize_street("Bulevardul Victoriei")
