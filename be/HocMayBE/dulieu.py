"""Tải 20 Newsgroups qua sklearn, chia tập trước khi học từ vựng."""
import hashlib as bambam
import json as dulieuchuoi
from datetime import datetime as thoigian, timezone as muigio
import pandas as bangdulieu
import sklearn as thuvienhocmay
from sklearn.datasets import fetch_20newsgroups as tainhomtin
from sklearn.model_selection import train_test_split as chianghiencuu

from duongdan import thumuctho, thumucxuly, tepchiatap, tepchatluong
from vanban import lamsach

chudedachon = [
    "comp.graphics", "comp.sys.ibm.pc.hardware", "misc.forsale", "rec.autos",
    "rec.sport.baseball", "sci.med", "sci.space", "talk.politics.guns",
]
hatgiong = 42


def taobaiviet(bodulieu: object, tap: str) -> list[dict]:
    baiviet = []
    for vitri, noidung in enumerate(bodulieu.data):
        chude = bodulieu.target_names[int(bodulieu.target[vitri])]
        tentep = bodulieu.filenames[vitri].replace("\\", "/").rsplit("/", 1)[-1]
        baiviet.append({
            "madinhdanh": f"{tap}/{chude}/{tentep}",
            "chude": chude,
            "noidung": lamsach(noidung),
            "tap": tap,
        })
    return baiviet


def dauvan(baiviet: list[dict]) -> str:
    noidung = dulieuchuoi.dumps(baiviet, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return bambam.sha256(noidung).hexdigest()


def chuanbi() -> dict:
    thumuctho.mkdir(parents=True, exist_ok=True)
    thumucxuly.mkdir(parents=True, exist_ok=True)
    # sklearn xác nhận split by-date; bỏ ba nguồn có thể lộ nhãn trước khi chia validation.
    chung = {"categories": chudedachon, "remove": ("headers", "footers", "quotes"),
             "data_home": str(thumuctho), "shuffle": False}
    bodulieuhuanluyen = tainhomtin(subset="train", **chung)
    bodulieukiemthu = tainhomtin(subset="test", **chung)
    baivietgoc = taobaiviet(bodulieuhuanluyen, "huanluyen")
    baivietkiemthu = taobaiviet(bodulieukiemthu, "kiemthu")
    # Chia có phân tầng trên train gốc; học từ vựng chỉ sau bước này.
    vitri = list(range(len(baivietgoc)))
    nhan = [baiviet["chude"] for baiviet in baivietgoc]
    vitrihuanluyen, vitrixacthuc = chianghiencuu(
        vitri, test_size=0.2, stratify=nhan, random_state=hatgiong,
    )
    taphuanluyen = [baivietgoc[vitri] for vitri in sorted(vitrihuanluyen)]
    tapxacthuc = [{**baivietgoc[vitri], "tap": "xacthuc"} for vitri in sorted(vitrixacthuc)]
    tapkiemthu = baivietkiemthu
    dagiu = set()
    baivietduocgiu = []
    loai = []
    for tap in (taphuanluyen, tapxacthuc, tapkiemthu):
        for baiviet in tap:
            vanban = baiviet["noidung"]
            if len(vanban) < 40:
                lydo = "quangan"
            else:
                mabam = bambam.sha256(vanban.lower().encode("utf-8")).hexdigest()
                lydo = "trunglap" if mabam in dagiu else None
                if lydo is None:
                    dagiu.add(mabam)
            if lydo:
                loai.append({"madinhdanh": baiviet["madinhdanh"], "chude": baiviet["chude"],
                             "tap": baiviet["tap"], "lydo": lydo})
            else:
                baivietduocgiu.append(baiviet)
    bang = bangdulieu.DataFrame(baivietduocgiu)
    banghuanluyen = bang[bang["tap"] == "huanluyen"].copy()
    banghuanluyen["dodai"] = banghuanluyen["noidung"].str.len()
    thongke = {
        "nguon": "https://scikit-learn.org/stable/modules/generated/sklearn.datasets.fetch_20newsgroups.html",
        "cachtai": "fetch_20newsgroups(remove=('headers','footers','quotes'))",
        "phienbanthuvien": thuvienhocmay.__version__,
        "ngaychayutc": thoigian.now(muigio.utc).isoformat(),
        "hatgiong": hatgiong,
        "chudedachon": chudedachon,
        "sobaigoc": len(baivietgoc) + len(baivietkiemthu),
        "sobaigiu": len(baivietduocgiu),
        "demtheotap": bang["tap"].value_counts().to_dict(),
        "demtheochude": bang.groupby(["tap", "chude"]).size().unstack(fill_value=0).to_dict(orient="index"),
        "thongkedodaichitrenhuanluyen": {
            khoa: float(giatri) for khoa, giatri in
            banghuanluyen["dodai"].describe().to_dict().items()
        },
        "sodongloai": len(loai),
        "dongloai": loai,
        "dauvan": dauvan(baivietduocgiu),
    }
    tepchiatap.write_text(dulieuchuoi.dumps(baivietduocgiu, ensure_ascii=False), encoding="utf-8")
    tepchatluong.write_text(dulieuchuoi.dumps(thongke, ensure_ascii=False, indent=2), encoding="utf-8")
    return thongke


def docchiatap() -> list[dict]:
    if not tepchiatap.exists():
        raise FileNotFoundError("Chưa chuẩn bị dữ liệu. Chạy python chaylenh.py chuanbi.")
    return dulieuchuoi.loads(tepchiatap.read_text(encoding="utf-8"))
