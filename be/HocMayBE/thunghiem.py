"""So sánh trên validation; test độc lập chỉ đo trong bước đánh giá cuối."""
import hashlib as bambam
import json as dulieuchuoi
import time as dongho
from datetime import datetime as thoigian, timezone as muigio
import joblib as luumohinh

from chiso import truyvanngan, kiemtravan, chamtruyvan, tonghop
from dulieu import docchiatap
from duongdan import (tepchatluong, tepmohinh, tepthamso, tepketqua, tepxacthuc,
                      teptruyvan, thumucmohinh, thumucbaocao)
from timkiem import taomohinh, botimkiem, trungtukhoa
from vanban import tachtu
from vehinh import phanbo, xacthuc as vedoxacthuc, nhamlan

cauhinhthunghiem = [
    {"name": "unigram", "config": {"minDf": 3, "maxDf": 0.95, "ngramMax": 1}},
    {"name": "unigrambigram", "config": {"minDf": 3, "maxDf": 0.95, "ngramMax": 2}},
    {"name": "mingiam", "config": {"minDf": 2, "maxDf": 0.95, "ngramMax": 2}},
    {"name": "mincaomaxthap", "config": {"minDf": 5, "maxDf": 0.85, "ngramMax": 2}},
]


def taodauvan(dulieu: object) -> str:
    chuoi = dulieuchuoi.dumps(dulieu, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return bambam.sha256(chuoi).hexdigest()


def ghijson(duongdan, dulieu: object) -> None:
    duongdan.parent.mkdir(parents=True, exist_ok=True)
    duongdan.write_text(dulieuchuoi.dumps(dulieu, ensure_ascii=False, indent=2), encoding="utf-8")


def laymau(baiviet: list[dict]) -> list[dict]:
    chude = sorted({muc["chude"] for muc in baiviet})
    return [muc for tenchude in chude for muc in sorted(
        (bai for bai in baiviet if bai["chude"] == tenchude),
        key=lambda bai: taodauvan(bai["madinhdanh"]))[:25]]


def docvan(chude: list[str]) -> list[dict]:
    truyvan = dulieuchuoi.loads(teptruyvan.read_text(encoding="utf-8"))
    if not kiemtravan(truyvan, chude):
        raise ValueError("Cần ít nhất 30 truy vấn riêng biệt có nhãn chủ đề hợp lệ.")
    return truyvan


def cham(batim: botimkiem | None, baiviet: list[dict], truyvan: list[dict],
          tukhoabaiviet: list[set[str]] | None = None) -> dict:
    danhsach = []
    for muc in truyvan:
        batdau = dongho.perf_counter()
        hang = (batim.tim(muc["truyvan"], 10) if batim is not None
                else trungtukhoa(muc["truyvan"], baiviet, 10, tukhoabaiviet))
        danhsach.append(chamtruyvan(
            muc["truyvan"], muc["chudelienquan"], hang,
            (dongho.perf_counter() - batdau) * 1000,
        ))
    return tonghop(danhsach)


def huanluyen() -> dict:
    tatca = docchiatap()
    taphuanluyen = [muc for muc in tatca if muc["tap"] == "huanluyen"]
    tapxacthuc = laymau([muc for muc in tatca if muc["tap"] == "xacthuc"])
    if not taphuanluyen or not tapxacthuc:
        raise ValueError("Thiếu train hoặc validation.")
    chude = sorted({muc["chude"] for muc in taphuanluyen})
    truyvanxacthuc = [{"truyvan": truyvanngan(muc), "chudelienquan": muc["chude"]}
                     for muc in tapxacthuc]
    truyvantutao = docvan(chude)
    tukhoabaiviet = [set(tachtu(muc["noidung"])) for muc in taphuanluyen]
    coban = cham(None, taphuanluyen, truyvanxacthuc, tukhoabaiviet)
    cobantutao = cham(None, taphuanluyen, truyvantutao, tukhoabaiviet)
    thunghiem = [{"name": "trungtukhoa", "config": None, "vocabularySize": 0,
                 "validation": coban, "manual": cobantutao}]
    cacmohinh = {}
    for muc in cauhinhthunghiem:
        print(f"Đang fit {muc['name']} trên {len(taphuanluyen)} bài train...", flush=True)
        mohinh = taomohinh(taphuanluyen, muc["config"])
        batim = botimkiem(mohinh)
        thunghiem.append({
            "name": muc["name"], "config": muc["config"],
            "vocabularySize": len(mohinh["duongong"].named_steps["vectorhoatu"].vocabulary_),
            "validation": cham(batim, taphuanluyen, truyvanxacthuc),
            "manual": cham(batim, taphuanluyen, truyvantutao),
        })
        cacmohinh[muc["name"]] = mohinh
    duocchon = sorted(thunghiem[1:], key=lambda muc: (
        -muc["validation"]["precisionAt5"], -muc["validation"]["mrr"],
        muc["vocabularySize"], muc["name"]))[0]
    mohinhcuoi = cacmohinh[duocchon["name"]]
    thumucmohinh.mkdir(parents=True, exist_ok=True)
    luumohinh.dump(mohinhcuoi, tepmohinh, compress=3)
    chatluong = dulieuchuoi.loads(tepchatluong.read_text(encoding="utf-8"))
    dauvan = taodauvan({"data": chatluong["dauvan"], "config": duocchon["config"],
                      "vocabulary": mohinhcuoi["duongong"].named_steps["vectorhoatu"].get_feature_names_out().tolist()})
    ghijson(tepthamso, {"ten": duocchon["name"], "cauhinh": duocchon["config"],
                         "dauvan": dauvan, "trainOnly": True})
    baocaoxacthuc = {"chosen": duocchon["name"], "experiments": thunghiem,
                    "heldOutQueryCount": len(truyvanxacthuc), "manualQueryCount": len(truyvantutao),
                    "experimentFingerprint": dauvan}
    ghijson(tepxacthuc, baocaoxacthuc)
    dem = {ten: sum(muc["chude"] == ten for muc in taphuanluyen) for ten in chude}
    phanbo(dem)
    vedoxacthuc(thunghiem)
    print(f"Đã chọn {duocchon['name']}; từ vựng {duocchon['vocabularySize']}; train {len(taphuanluyen)} bài.", flush=True)
    return baocaoxacthuc


def danhgia() -> dict:
    if not tepmohinh.exists() or not tepthamso.exists() or not tepxacthuc.exists():
        raise FileNotFoundError("Chạy python chaylenh.py huanluyen trước.")
    thamso = dulieuchuoi.loads(tepthamso.read_text(encoding="utf-8"))
    if tepketqua.exists():
        ketquacu = dulieuchuoi.loads(tepketqua.read_text(encoding="utf-8"))
        if ketquacu.get("experimentFingerprint") == thamso["dauvan"]:
            print("Đã có kết quả test cho cùng dữ liệu/mô hình; dùng lại, không chạy test lần nữa.", flush=True)
            return ketquacu
        raise RuntimeError("Test đã được chấm với mô hình khác. Lưu kết quả cũ trước khi đánh giá bản mới.")
    # Tới đây mới chạm tới split test. Không dùng số test để chọn cấu hình.
    tatca = docchiatap()
    tapkiemthu = laymau([muc for muc in tatca if muc["tap"] == "kiemthu"])
    if not tapkiemthu:
        raise ValueError("Tập test rỗng.")
    mohinh = luumohinh.load(tepmohinh)
    if any(muc["tap"] != "huanluyen" for muc in mohinh["baiviet"]):
        raise ValueError("Model phục vụ chứa dữ liệu ngoài train.")
    xacthuc = dulieuchuoi.loads(tepxacthuc.read_text(encoding="utf-8"))
    chude = mohinh["chude"]
    truyvantest = [{"truyvan": truyvanngan(muc), "chudelienquan": muc["chude"]}
                   for muc in tapkiemthu]
    truyvantutao = docvan(chude)
    tukhoabaiviet = [set(tachtu(muc["noidung"])) for muc in mohinh["baiviet"]]
    batim = botimkiem(mohinh)
    test = cham(batim, mohinh["baiviet"], truyvantest)
    baseline = cham(None, mohinh["baiviet"], truyvantest, tukhoabaiviet)
    manual = cham(batim, mohinh["baiviet"], truyvantutao)
    ketqua = {
        "evaluatedAtUtc": thoigian.now(muigio.utc).isoformat(),
        "selectedModel": xacthuc["chosen"],
        "validation": xacthuc["experiments"],
        "test": test, "baselineTest": baseline, "manual": manual,
        "index": {"documents": len(mohinh["baiviet"]),
                  "vocabularySize": len(mohinh["duongong"].named_steps["vectorhoatu"].vocabulary_),
                  "categories": chude, "config": mohinh["cauhinh"]},
        "protocol": "By-date test was used once after validation selection; all vectorizers and serving index fitted on train only. Same 25 queries per category selected by stable ID hash; relevance proxy is shared newsgroup category; MRR@10.",
        "experimentFingerprint": thamso["dauvan"],
    }
    ghijson(tepketqua, ketqua)
    nhamlan(test, chude)
    (thumucbaocao / "themohinh.md").write_text(
        f"# Thẻ mô hình\n\n- Phương pháp: TF–IDF word n-gram, cosine, chuẩn hóa L2.\n"
        f"- Cấu hình chọn: {xacthuc['chosen']} `{mohinh['cauhinh']}`.\n"
        f"- Chỉ fit train: {len(mohinh['baiviet'])} bài, {ketqua['index']['vocabularySize']} token.\n"
        f"- Validation: chọn bằng Precision@5 rồi MRR@10; 32 truy vấn tự xây báo riêng.\n"
        f"- Test by-date ({test['queries']} truy vấn): Precision@5 {test['precisionAt5']:.3f}, MRR@10 {test['mrr']:.3f}.\n"
        f"- Baseline test: Precision@5 {baseline['precisionAt5']:.3f}, MRR@10 {baseline['mrr']:.3f}.\n"
        "- Giới hạn: nhãn chủ đề chỉ là proxy liên quan; dữ liệu tiếng Anh cũ; cosine không là xác suất và không đủ làm tư vấn y tế.\n"
        "- An toàn: bỏ header/footer/quote và che email, URL, số điện thoại.\n",
        encoding="utf-8",
    )
    print(f"Test: P@5={test['precisionAt5']:.3f}; MRR={test['mrr']:.3f}; baseline P@5={baseline['precisionAt5']:.3f}", flush=True)
    return ketqua
