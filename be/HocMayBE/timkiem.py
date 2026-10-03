"""TF–IDF cosine và baseline đếm từ trùng cho cùng một kho train."""
import time as dongho
from datetime import datetime as thoigian, timezone as muigio
import numpy as mangso
from sklearn.feature_extraction.text import TfidfVectorizer as bochuyenvecto
from sklearn.pipeline import Pipeline as duongonghocmay

from vanban import tachtu, trichdoan


def taomohinh(baiviet: list[dict], cauhinh: dict) -> dict:
    if not baiviet:
        raise ValueError("Tập huấn luyện rỗng.")
    if any(muc["tap"] != "huanluyen" for muc in baiviet):
        raise ValueError("Chỉ được fit trên tập huấn luyện.")
    bo = bochuyenvecto(
        min_df=cauhinh["minDf"], max_df=cauhinh["maxDf"],
        ngram_range=(1, cauhinh["ngramMax"]), norm="l2", use_idf=True,
        smooth_idf=True, sublinear_tf=False,
        token_pattern=r"(?u)\b[a-z0-9]+(?:'[a-z]+)?\b",
        lowercase=True, dtype=mangso.float32,
    )
    duongong = duongonghocmay([("vectorhoatu", bo)])
    matran = duongong.fit_transform([muc["noidung"] for muc in baiviet])
    return {
        "phienban": 1,
        "thoigiantao": thoigian.now(muigio.utc).isoformat(),
        "nguon": "20 Newsgroups train by-date; validation tách từ train gốc",
        "cauhinh": cauhinh,
        "chude": sorted({muc["chude"] for muc in baiviet}),
        "baiviet": baiviet,
        "duongong": duongong,
        "matran": matran,
    }


class botimkiem:
    def __init__(self, mohinh: dict):
        if mohinh.get("phienban") != 1 or len(mohinh["baiviet"]) != mohinh["matran"].shape[0]:
            raise ValueError("Model artifact không hợp lệ.")
        self.mohinh = mohinh

    def tim(self, truyvan: str, soluong: int = 10, chude: str | None = None) -> list[dict]:
        vectotruyvan = self.mohinh["duongong"].transform([truyvan])
        if vectotruyvan.nnz == 0:
            return []
        diem = (self.mohinh["matran"] @ vectotruyvan.T).toarray().ravel()
        ungvien = [vitri for vitri, giatri in enumerate(diem)
                   if giatri > 0 and (chude is None or self.mohinh["baiviet"][vitri]["chude"] == chude)]
        ungvien.sort(key=lambda vitri: (-float(diem[vitri]), self.mohinh["baiviet"][vitri]["madinhdanh"]))
        tenvec = self.mohinh["duongong"].named_steps["vectorhoatu"].get_feature_names_out()
        ketqua = []
        for vitri in ungvien[:soluong]:
            baiviet = self.mohinh["baiviet"][vitri]
            vectobaiviet = self.mohinh["matran"].getrow(vitri)
            donggop = vectobaiviet.multiply(vectotruyvan).tocoo()
            tukhoa = sorted(
                ({"term": str(tenvec[cot]), "contribution": round(float(giatri), 6)}
                 for cot, giatri in zip(donggop.col, donggop.data) if giatri > 0),
                key=lambda muc: -muc["contribution"],
            )[:5]
            ketqua.append({
                "id": baiviet["madinhdanh"], "category": baiviet["chude"],
                "score": round(float(diem[vitri]), 6),
                "snippet": trichdoan(baiviet["noidung"], truyvan),
                "contributingTerms": tukhoa,
            })
        return ketqua


def trungtukhoa(truyvan: str, baiviet: list[dict], soluong: int = 10,
                tukhoabaiviet: list[set[str]] | None = None) -> list[dict]:
    tukhoatruyvan = set(tachtu(truyvan))
    if not tukhoatruyvan:
        return []
    if tukhoabaiviet is None:
        tukhoabaiviet = [set(tachtu(muc["noidung"])) for muc in baiviet]
    hang = []
    for vitri, muc in enumerate(baiviet):
        diem = len(tukhoatruyvan.intersection(tukhoabaiviet[vitri]))
        if diem:
            hang.append((diem, muc["madinhdanh"], vitri))
    hang.sort(key=lambda muc: (-muc[0], muc[1]))
    return [{"id": baiviet[vitri]["madinhdanh"], "category": baiviet[vitri]["chude"],
             "score": float(diem), "snippet": trichdoan(baiviet[vitri]["noidung"], truyvan),
             "contributingTerms": []} for diem, _, vitri in hang[:soluong]]
