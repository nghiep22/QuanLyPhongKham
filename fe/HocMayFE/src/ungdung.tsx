import { useEffect as dungtacdong, useRef as dungthamchieu, useState as dungtrangthai, createElement as taophantu, type FormEvent as sukienbieumau } from "react";
import { giaotiep, type baocaodanhgia, type ketquatimkiem, type thongtinmohinh } from "./giaotiep";
type trang = "gioithieu" | "timkiem" | "danhgia";
type luachontimkiem = {
    truyvan: string;
    chude: string;
    soketqua: number;
};
function laytrangtudiachi(): trang {
    const madiachi = location.hash.slice(1);
    return madiachi === "timkiem" || madiachi === "danhgia" ? madiachi : "gioithieu";
}
const truyvanmau = [
    "space shuttle launch mission",
    "medical treatment for disease symptoms",
    "baseball team standings",
    "computer graphics image rendering",
];
function dinhdangphantram(giatri: number) { return `${(giatri * 100).toFixed(1)}%`; }
function dinhdangso(giatri: number) { return new Intl.NumberFormat("vi-VN").format(giatri); }
function thethongke({ tennhan, giatri, chitiet }: {
    tennhan: string;
    giatri: string;
    chitiet: string;
}) {
    return <article className="thethongke"><span>{tennhan}</span><strong>{giatri}</strong><small>{chitiet}</small></article>;
}
function thanhdiem({ tennhan, giatri, noibat = false }: {
    tennhan: string;
    giatri: number;
    noibat?: boolean;
}) {
    const phantram = Math.max(0, Math.min(100, giatri * 100));
    return <div className="hangdiem"><span>{tennhan}</span><div className="duongdiem" role="meter" aria-label={tennhan} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phantram)}><i className={noibat ? "noibat" : ""} style={{ width: `${phantram}%` }}/></div><strong>{dinhdangphantram(giatri)}</strong></div>;
}
function trangtimkiem({ thongtin, loithongtin, dangtaithongtin, thulaithongtin }: {
    thongtin: thongtinmohinh | null;
    loithongtin: string | null;
    dangtaithongtin: boolean;
    thulaithongtin: () => void;
}) {
    const [truyvan, dattruyvan] = dungtrangthai("");
    const [chude, datchude] = dungtrangthai("");
    const [soketqua, datsoketqua] = dungtrangthai(10);
    const [cacketqua, datcacketqua] = dungtrangthai<ketquatimkiem[]>([]);
    const [thoigianphanhoims, datthoigianphanhoims] = dungtrangthai<number | null>(null);
    const [canhbao, datcanhbao] = dungtrangthai<string | null>(null);
    const [loi, datloi] = dungtrangthai<string | null>(null);
    const [dangtai, datdangtai] = dungtrangthai(false);
    const [daapdung, datdaapdung] = dungtrangthai<luachontimkiem | null>(null);
    const [dangcho, datdangcho] = dungtrangthai<luachontimkiem | null>(null);
    const mayeucau = dungthamchieu(0);
    dungtacdong(() => () => { mayeucau.current++; }, []);
    async function timkiem(truyvanvao: string, chudetieptheo = chude, soketquatieptheo = soketqua) {
        const hientai = ++mayeucau.current;
        const truyvantieptheo = truyvanvao.trim();
        datcacketqua([]);
        datthoigianphanhoims(null);
        datcanhbao(null);
        datdaapdung(null);
        if (truyvantieptheo.length < 2) {
            datdangcho(null);
            datdangtai(false);
            datloi("Vui lòng nhập ít nhất 2 ký tự.");
            return;
        }
        datdangcho({ truyvan: truyvantieptheo, chude: chudetieptheo, soketqua: soketquatieptheo });
        datdangtai(true);
        datloi(null);
        try {
            const ketqua = await giaotiep.timkiem(truyvantieptheo, soketquatieptheo, chudetieptheo);
            if (hientai !== mayeucau.current)
                return;
            datcacketqua(ketqua.cacketqua);
            datthoigianphanhoims(ketqua.thoigianphanhoims);
            datcanhbao(ketqua.canhbao);
            datdaapdung({ truyvan: truyvantieptheo, chude: chudetieptheo, soketqua: soketquatieptheo });
            datdangcho(null);
        }
        catch (nguyenhan) {
            if (hientai === mayeucau.current) {
                datdangcho(null);
                datloi(nguyenhan instanceof Error ? nguyenhan.message : "Không thể tìm kiếm.");
            }
        }
        finally {
            if (hientai === mayeucau.current)
                datdangtai(false);
        }
    }
    function guibieumau(sukien: sukienbieumau) { sukien.preventDefault(); void timkiem(truyvan); }
    const truyvandadoi = daapdung !== null && truyvan.trim() !== daapdung.truyvan;
    const capnhatchude = (giatri: string) => {
        datchude(giatri);
        if (truyvan.trim().length >= 2 && (daapdung || dangtai))
            void timkiem(truyvan, giatri, soketqua);
    };
    const capnhatsoketqua = (giatri: number) => {
        datsoketqua(giatri);
        if (truyvan.trim().length >= 2 && (daapdung || dangtai))
            void timkiem(truyvan, chude, giatri);
    };
    return <main className="khungtrang trangtimkiem">
    <div className="hanggioithieu"><div><span className="nhanphu">02 / THỬ CÔNG CỤ</span><h1>Tìm bài đăng theo nội dung</h1><p>Nhập một cụm từ tiếng Anh. Hệ thống xếp hạng tài liệu bằng TF–IDF và độ tương đồng cosine.</p></div><div className={`nhantapdulieu${thongtin ? "" : " chuasan"}`}><span className="chamtrangthai"/>{thongtin ? `${dinhdangso(thongtin.sotailieu)} bài đã lập chỉ mục` : dangtaithongtin ? "Đang kết nối mô hình" : "Mô hình chưa sẵn sàng"}</div></div>
    <div className="bocuctimkiem"><section className="khungtimkiem">
      <form onSubmit={guibieumau}>
        <label htmlFor="truyvan">Nội dung cần tìm</label>
        <div className="hangtruyvan"><input id="truyvan" type="search" name="q" autoFocus value={truyvan} maxLength={200} onChange={(sukien) => dattruyvan(sukien.target.value)} placeholder="Ví dụ: space shuttle launch mission"/><button disabled={dangtai || !thongtin} type="submit">{dangtai ? "Đang tìm…" : "Tìm kiếm →"}</button></div>
        <div className="hangboloc"><label>Chủ đề<select value={chude} onChange={(sukien) => capnhatchude(sukien.target.value)}><option value="">Tất cả chủ đề</option>{thongtin?.cacchude.map((muc) => <option key={muc}>{muc}</option>)}</select></label><label>Số kết quả<select value={soketqua} onChange={(sukien) => capnhatsoketqua(Number(sukien.target.value))}><option value="5">5</option><option value="10">10</option><option value="20">20</option></select></label></div>
      </form>
      <div className="khungvidu"><strong>Thử truy vấn</strong><div>{truyvanmau.map((muc) => <button key={muc} disabled={!thongtin} onClick={() => { dattruyvan(muc); void timkiem(muc); }}>{muc} ↗</button>)}</div></div>
      <div className="ghichu"><strong>Giới hạn của kết quả</strong><p>Điểm số thể hiện mức khớp từ ngữ trong tập thảo luận tiếng Anh cũ. Kết quả không phải lời khuyên y tế.</p></div>
    </section><section className="khungketqua" aria-busy={dangtai} aria-labelledby="tieudaeketqua">
      <div className="dauketqua"><div><span className="nhanphu">KẾT QUẢ</span><h2 id="tieudaeketqua">{dangtai ? "Đang đối chiếu tài liệu…" : thoigianphanhoims === null ? "Bắt đầu bằng một truy vấn" : `${cacketqua.length} tài liệu phù hợp`}</h2></div>{thoigianphanhoims !== null && <span className="nhanthoigian">{thoigianphanhoims.toFixed(1)} ms</span>}</div>
      <div className="trangthaiketqua" role="status" aria-live="polite">{dangcho ? `Đang tìm “${dangcho.truyvan}” · ${dangcho.chude || "Tất cả chủ đề"} · tối đa ${dangcho.soketqua} kết quả` : daapdung ? `“${daapdung.truyvan}” · ${daapdung.chude || "Tất cả chủ đề"} · tối đa ${daapdung.soketqua} kết quả` : ""}</div>
      {truyvandadoi && <div className="bolocdadoi">Bạn đã sửa truy vấn. Bấm <strong>Tìm kiếm</strong> để cập nhật kết quả.</div>}
      {(loi || loithongtin) && <div className="loi" role="alert">{loi ?? loithongtin}{loithongtin && <button type="button" className="nutthulai" disabled={dangtaithongtin} onClick={thulaithongtin}>{dangtaithongtin ? "Đang thử lại…" : "Thử kết nối lại"}</button>}</div>}
      {canhbao && <div className="ghichu" role="status">{canhbao}</div>}
      {dangtai ? <div className="trangthaidangtai"><span className="vongdangtai" aria-hidden="true"/><strong>Đang xếp hạng kết quả</strong><p>So sánh truy vấn với các tài liệu đã lập chỉ mục.</p></div>
            : cacketqua.length ? <ol className="danhsachketqua">{cacketqua.map((tailieu, chimuc) => <li key={tailieu.matalieu}><div className="dautailieu"><span className="thututailieu">{String(chimuc + 1).padStart(2, "0")}</span><span className="nhanchude">{tailieu.chude}</span><strong>Cosine {tailieu.diem.toFixed(3)}</strong></div><h3>Bài đăng {tailieu.matalieu.split("/").at(-1)}</h3><p>{tailieu.trichdoan}</p><div className="cactu">{tailieu.tudonggop.map((tu) => <span key={tu.tu}>{tu.tu}</span>)}</div></li>)}</ol>
                : !loi && !loithongtin && <div className="trangthaibong"><span aria-hidden="true">⌕</span><strong>{daapdung ? "Không tìm thấy tài liệu phù hợp" : "Chưa có kết quả"}</strong><p>{daapdung ? "Thử một cụm từ khác hoặc chọn tất cả chủ đề." : "Hãy thử một trong các truy vấn mẫu hoặc nhập câu của bạn."}</p></div>}
    </section></div>
  </main>;
}
function trangdanhgia({ baocao, loi, dangtai, thulai }: {
    baocao: baocaodanhgia | null;
    loi: string | null;
    dangtai: boolean;
    thulai: () => void;
}) {
    if (!baocao)
        return <main className="khungtrang trangdanhgia"><span className="nhanphu">03 / ĐÁNH GIÁ</span><h1>Dashboard & model card</h1><div className="the danhgiachuasan" role={loi ? "alert" : "status"}><span className="bieutuongdanhgiachuasan" aria-hidden="true">▤</span><h2>{dangtai ? "Đang tải báo cáo" : "Chưa xem được báo cáo"}</h2><p>{dangtai ? "Đang lấy số liệu đánh giá từ mô hình." : loi ?? "Chưa có kết quả. Chạy pipeline ở HocMayBE để tạo báo cáo."}</p><button type="button" disabled={dangtai} onClick={thulai}>{dangtai ? "Đang tải…" : "Tải lại báo cáo ↻"}</button></div></main>;
    const { kiemthu, kiemthucoso, xacthuc, truyvantuxay, chimuc } = baocao;
    return <main className="khungtrang trangdanhgia"><span className="nhanphu">03 / ĐÁNH GIÁ</span><h1>Dashboard & model card</h1><p className="mota">Kết quả kiểm thử độc lập sau khi chọn cấu hình trên tập validation. Nhãn chủ đề được dùng làm chỉ dấu liên quan.</p>
    <div className="luoithongke">{taophantu(thethongke, { tennhan: "Precision@5 · test", giatri: dinhdangphantram(kiemthu.dochinhxactopnam), chitiet: `${kiemthu.sotruyvan} truy vấn từ tài liệu test` })}{taophantu(thethongke, { tennhan: "MRR · test", giatri: kiemthu.thuhangdaonghichtrungbinh.toFixed(3), chitiet: "Vị trí kết quả đúng đầu tiên" })}{taophantu(thethongke, { tennhan: "Trung vị phản hồi", giatri: `${kiemthu.thoigiantrungvims.toFixed(1)} ms`, chitiet: `P95 ${kiemthu.thoigianp95ms.toFixed(1)} ms` })}{taophantu(thethongke, { tennhan: "Từ vựng", giatri: dinhdangso(chimuc.sotuvung), chitiet: `${dinhdangso(chimuc.sotailieu)} tài liệu được lập chỉ mục` })}</div>
    <div className="luoibaocao"><section className="the"><span className="nhanphu">SO SÁNH BASELINE</span><h2>TF–IDF so với trùng từ khóa</h2>{taophantu(thanhdiem, { tennhan: "TF–IDF · Precision@5", giatri: kiemthu.dochinhxactopnam, noibat: true })}{taophantu(thanhdiem, { tennhan: "Trùng từ · Precision@5", giatri: kiemthucoso.dochinhxactopnam })}{taophantu(thanhdiem, { tennhan: "TF–IDF · MRR", giatri: kiemthu.thuhangdaonghichtrungbinh, noibat: true })}{taophantu(thanhdiem, { tennhan: "Trùng từ · MRR", giatri: kiemthucoso.thuhangdaonghichtrungbinh })}<p className="goiy">Cùng tập test, cùng cách đánh giá. Không suy ra quan hệ nhân quả từ chênh lệch này.</p></section>
      <section className="the"><span className="nhanphu">THÍ NGHIỆM VALIDATION</span><h2>Chọn cấu hình</h2>{xacthuc.map((muc) => taophantu(thanhdiem, { key: muc.ten, tennhan: `${muc.ten.replaceAll("_", " ")}${muc.ten === baocao.mohinhduocchon ? " ✓" : ""}`, giatri: muc.xacthuc.dochinhxactopnam, noibat: muc.ten === baocao.mohinhduocchon }))}<p className="goiy">Unigram, bigram và min_df/max_df được chọn trên validation; test chỉ dùng để kết luận.</p></section></div>
    <div className="luoibaocao"><section className="the"><span className="nhanphu">BỘ TRUY VẤN TỰ XÂY</span><h2>{truyvantuxay.sotruyvan} truy vấn có nhãn</h2><p>Precision@5: <strong>{dinhdangphantram(truyvantuxay.dochinhxactopnam)}</strong> · MRR: <strong>{truyvantuxay.thuhangdaonghichtrungbinh.toFixed(3)}</strong></p><p className="goiy">Mỗi truy vấn gắn với một chủ đề liên quan. Đây là nhãn ở mức chủ đề, chưa phải đánh giá thủ công mức từng bài.</p></section>
      <section className="the"><span className="nhanphu">MODEL CARD</span><h2>Phạm vi và giới hạn</h2><ul className="danhsachdon"><li>Mô hình: word TF–IDF, vector chuẩn hóa L2, xếp hạng cosine.</li><li>Cấu hình: n-gram 1–{chimuc.cauhinh.bacngramtoida}, min_df {chimuc.cauhinh.tansuattoithieu}, max_df {chimuc.cauhinh.tansuattoida}.</li><li>Dữ liệu: bài đăng tiếng Anh thuộc 8 nhóm của 20 Newsgroups.</li><li>Chỉ đo độ giống từ vựng; không hiểu ngữ nghĩa hay chẩn đoán y khoa.</li></ul></section></div>
    <section className="the phantichloi"><span className="nhanphu">PHÂN TÍCH LỖI</span><h2>Truy vấn có kết quả đầu khác chủ đề</h2>{kiemthu.cacloi.length ? <div className="luoiloi">{kiemthu.cacloi.slice(0, 6).map((muc, chimuc) => <article key={`${muc.truyvan}-${chimuc}`}><p>“{muc.truyvan.slice(0, 110)}…”</p><small>Mong đợi: {muc.chudelienquan}<br />Đứng đầu: {muc.chudedungdau ?? "không có"}</small></article>)}</div> : <p>Không có lỗi trong mẫu truy vấn được báo cáo.</p>}</section>
  </main>;
}
function tranggioithieu({ thongtin, loithongtin, dangtaithongtin, thulaithongtin, motimkiem }: {
    thongtin: thongtinmohinh | null;
    loithongtin: string | null;
    dangtaithongtin: boolean;
    thulaithongtin: () => void;
    motimkiem: () => void;
}) {
    return <main><section className="gioithieunoi"><div className="khungtrang noidunggioithieu"><div><span className="nhanphu sang">HỌC MÁY CƠ BẢN · PROJECT 02</span><h1>Tìm đúng nội dung<br /><em>từ một câu truy vấn.</em></h1><p>Một công cụ tìm kiếm văn bản nhỏ, minh bạch và đo được: TF–IDF biến bài đăng thành vector; cosine xếp hạng mức tương đồng.</p><button className="nutgioithieu" onClick={motimkiem}>Thử tìm kiếm <span>↗</span></button><div className="thongtingioithieu"><span>8 chủ đề chọn lọc</span><span>32 truy vấn tự xây</span><span>Đánh giá trên test độc lập</span></div></div><div className="hinhgioithieu" aria-hidden="true"><div className="vongtron vongtronmot"/><div className="vongtron vongtronhai"/><div className="tamhinh">TF<br /><strong>IDF</strong></div><div className="thenoi mot"><b>01</b><span>Truy vấn<br /><strong>space shuttle</strong></span></div><div className="thenoi hai"><b>02</b><span>Vector hóa<br /><strong>từ khóa × trọng số</strong></span></div><div className="thenoi ba"><b>03</b><span>Xếp hạng<br /><strong>cosine score</strong></span></div></div></div></section>
    <div className="khungtrang noidungphamvi"><div className="hanggioithieu"><div><span className="nhanphu">01 / CÁCH HOẠT ĐỘNG</span><h2>Ba bước, một kết quả có thể giải thích</h2></div><p>Tập dữ liệu được chuẩn bị và lập chỉ mục trước. Mỗi yêu cầu tìm kiếm chỉ vector hóa truy vấn và tính điểm với các tài liệu đã lưu.</p></div><div className="cacbuoc"><article><span>01</span><h3>Chuẩn bị dữ liệu</h3><p>Loại header, email và phần trích dẫn; chia train, validation, test trước khi học từ vựng.</p></article><article><span>02</span><h3>Tính TF–IDF</h3><p>Từ phổ biến được giảm trọng số; unigram và bigram tạo nên biểu diễn văn bản.</p></article><article><span>03</span><h3>Xếp hạng cosine</h3><p>So sánh vector truy vấn với bài đăng, trả Top-N cùng điểm và từ khóa đóng góp.</p></article></div><div className="ghichugioithieu"><div><span className="nhanphu">DỮ LIỆU DEMO</span><h3>20 Newsgroups</h3><p>{thongtin ? `${dinhdangso(thongtin.sotailieu)} tài liệu train được lập chỉ mục` : dangtaithongtin ? "Đang kiểm tra mô hình" : "Cần chạy pipeline để nạp mô hình"}. Đây là dữ liệu thảo luận tiếng Anh dùng cho bài tập, không phải dữ liệu bệnh nhân của phòng khám.</p></div><button onClick={motimkiem}>Mở công cụ ↗</button></div>{loithongtin && <div className="thongbaoketnoi" role="alert"><span>{loithongtin}</span><button type="button" disabled={dangtaithongtin} onClick={thulaithongtin}>{dangtaithongtin ? "Đang thử lại…" : "Thử kết nối lại ↻"}</button></div>}</div></main>;
}
export function ungdung() {
    const [tranghientai, dattranghientai] = dungtrangthai<trang>(laytrangtudiachi);
    const [thongtin, datthongtin] = dungtrangthai<thongtinmohinh | null>(null);
    const [loithongtin, datloithongtin] = dungtrangthai<string | null>(null);
    const [dangtaithongtin, datdangtaithongtin] = dungtrangthai(true);
    const [baocao, datbaocao] = dungtrangthai<baocaodanhgia | null>(null);
    const [loibaocao, datloibaocao] = dungtrangthai<string | null>(null);
    const [dangtaibaocao, datdangtaibaocao] = dungtrangthai(true);
    const mayeucauthongtin = dungthamchieu(0);
    const mayeucaubaocao = dungthamchieu(0);
    async function taithongtin() {
        const hientai = ++mayeucauthongtin.current;
        datdangtaithongtin(true);
        datloithongtin(null);
        try {
            const tieptheo = await giaotiep.thongtin();
            if (hientai === mayeucauthongtin.current)
                datthongtin(tieptheo);
        }
        catch (nguyenhan) {
            if (hientai === mayeucauthongtin.current) {
                datthongtin(null);
                datloithongtin(nguyenhan instanceof Error ? nguyenhan.message : "Không kết nối được BE.");
            }
        }
        finally {
            if (hientai === mayeucauthongtin.current)
                datdangtaithongtin(false);
        }
    }
    async function taibaocao() {
        const hientai = ++mayeucaubaocao.current;
        datdangtaibaocao(true);
        datloibaocao(null);
        try {
            const tieptheo = await giaotiep.danhgia();
            if (hientai === mayeucaubaocao.current)
                datbaocao(tieptheo);
        }
        catch (nguyenhan) {
            if (hientai === mayeucaubaocao.current) {
                datbaocao(null);
                datloibaocao(nguyenhan instanceof Error ? nguyenhan.message : "Không tải được đánh giá.");
            }
        }
        finally {
            if (hientai === mayeucaubaocao.current)
                datdangtaibaocao(false);
        }
    }
    dungtacdong(() => {
        void taithongtin();
        void taibaocao();
        return () => { mayeucauthongtin.current++; mayeucaubaocao.current++; };
    }, []);
    dungtacdong(() => { const langnghe = () => dattranghientai(laytrangtudiachi()); addEventListener("hashchange", langnghe); return () => removeEventListener("hashchange", langnghe); }, []);
    dungtacdong(() => { window.scrollTo(0, 0); document.title = `${tranghientai === "gioithieu" ? "Giới thiệu" : tranghientai === "timkiem" ? "Tìm kiếm" : "Đánh giá mô hình"} · Học máy cơ bản`; }, [tranghientai]);
    function chuyentrang(tieptheo: trang) { location.hash = tieptheo; dattranghientai(tieptheo); window.scrollTo(0, 0); }
    return <><header className="dautrang"><div className="khungtrang noidungdautrang"><button className="thuonghieu" onClick={() => chuyentrang("gioithieu")} aria-label="Về trang giới thiệu"><span className="bieutuongthuonghieu">✳</span><span><strong>NỘI DUNG</strong><small>TÌM KIẾM THÔNG MINH</small></span></button><nav aria-label="Điều hướng"><button className={tranghientai === "gioithieu" ? "dangchon" : ""} aria-current={tranghientai === "gioithieu" ? "page" : undefined} onClick={() => chuyentrang("gioithieu")}>Giới thiệu</button><button className={tranghientai === "timkiem" ? "dangchon" : ""} aria-current={tranghientai === "timkiem" ? "page" : undefined} onClick={() => chuyentrang("timkiem")}>Tìm kiếm</button><button className={tranghientai === "danhgia" ? "dangchon" : ""} aria-current={tranghientai === "danhgia" ? "page" : undefined} onClick={() => chuyentrang("danhgia")}>Đánh giá & mô hình</button></nav><span className="tenduan">PROJECT 02 <i /></span></div></header>
    {tranghientai === "gioithieu" ? taophantu(tranggioithieu, { thongtin: thongtin, loithongtin: loithongtin, dangtaithongtin: dangtaithongtin, thulaithongtin: () => void taithongtin(), motimkiem: () => chuyentrang("timkiem") }) : tranghientai === "timkiem" ? taophantu(trangtimkiem, { thongtin: thongtin, loithongtin: loithongtin, dangtaithongtin: dangtaithongtin, thulaithongtin: () => void taithongtin() }) : taophantu(trangdanhgia, { baocao: baocao, loi: loibaocao, dangtai: dangtaibaocao, thulai: () => void taibaocao() })}
    <footer><div className="khungtrang noidungcuoitrang"><span>✳ Tìm kiếm bài viết theo nội dung</span><span>TF–IDF · cosine · 20 Newsgroups</span></div></footer></>;
}
