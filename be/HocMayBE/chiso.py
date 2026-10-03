"""Chỉ số đánh giá retrieval với nhãn chủ đề làm relevance proxy."""
import math as toanhoc
import statistics as thongke

from vanban import tachtu


def truyvanngan(baiviet: dict) -> str:
    return " ".join(tachtu(baiviet["noidung"])[:18])


def kiemtravan(truyvan: list, chude: list[str]) -> bool:
    return (len(truyvan) >= 30
            and len({muc["madinhdanh"] for muc in truyvan}) == len(truyvan)
            and all(muc["truyvan"].strip() and muc["chudelienquan"] in chude for muc in truyvan))


def chamtruyvan(truyvan: str, chudelienquan: str, hang: list[dict], dotrems: float) -> dict:
    nandau = next((vitri for vitri, muc in enumerate(hang) if muc["category"] == chudelienquan), None)
    return {
        "query": truyvan,
        "relevantCategory": chudelienquan,
        "precisionAt5": sum(muc["category"] == chudelienquan for muc in hang[:5]) / 5,
        "reciprocalRank": 1 / (nandau + 1) if nandau is not None else 0.0,
        "latencyMs": dotrems,
        "topCategory": hang[0]["category"] if hang else None,
    }


def trungbinh(giatri: list[float]) -> float:
    return 0.0 if not giatri else sum(giatri) / len(giatri)


def phanvi(giatri: list[float], tyle: float) -> float:
    if not giatri:
        return 0.0
    sapxep = sorted(giatri)
    return sapxep[max(0, toanhoc.ceil(tyle * len(sapxep)) - 1)]


def tonghop(caclan: list[dict]) -> dict:
    chude = sorted({muc["relevantCategory"] for muc in caclan})
    theochude = {}
    nhamlan = {}
    for tenchude in chude:
        nhom = [muc for muc in caclan if muc["relevantCategory"] == tenchude]
        theochude[tenchude] = {
            "queries": len(nhom),
            "precisionAt5": trungbinh([muc["precisionAt5"] for muc in nhom]),
            "mrr": trungbinh([muc["reciprocalRank"] for muc in nhom]),
        }
        nhamlan[tenchude] = {}
        for muc in nhom:
            dudoan = muc["topCategory"] or "no match"
            nhamlan[tenchude][dudoan] = nhamlan[tenchude].get(dudoan, 0) + 1
    loi = [muc for muc in caclan if muc["topCategory"] != muc["relevantCategory"]]
    loi.sort(key=lambda muc: (muc["reciprocalRank"], muc["precisionAt5"]))
    return {
        "queries": len(caclan),
        "precisionAt5": trungbinh([muc["precisionAt5"] for muc in caclan]),
        "mrr": trungbinh([muc["reciprocalRank"] for muc in caclan]),
        "medianLatencyMs": thongke.median([muc["latencyMs"] for muc in caclan]) if caclan else 0.0,
        "p95LatencyMs": phanvi([muc["latencyMs"] for muc in caclan], 0.95),
        "byCategory": theochude,
        "errors": loi[:12],
        "confusion": nhamlan,
    }
