# Công cụ tìm kiếm bài viết theo nội dung bằng TF–IDF và cosine

Tài liệu nguồn biên tập cho báo cáo học phần. Bản DOCX/PDF được tạo từ kết quả thực nghiệm trong `results.json`. Các mục tên nhóm, giảng viên và nhật ký tuần cần nhóm điền theo thực tế trước khi nộp.

## Tóm tắt

Nhóm xây dựng một công cụ truy hồi văn bản trên 8 nhóm của 20 Newsgroups. Mỗi bài đăng là một tài liệu trong kho; người dùng nhập truy vấn ngắn, hệ thống trả về các tài liệu có điểm cosine cao nhất. Từ vựng TF–IDF chỉ được học từ tập train khi chọn cấu hình. Mô hình cuối được fit lại trên train và validation sau khi chốt tham số; test theo ngày của bộ dữ liệu chỉ dùng để kết luận. Baseline đếm số từ khóa xuất hiện trong mỗi tài liệu.

Kết quả chạy ngày 24/09/2026: 7.801 bài thuộc 8 chủ đề được đọc; 99 bài quá ngắn và 27 bản trùng bị loại, còn 3.698 train, 918 validation, 3.059 test. Trên 200 truy vấn rút từ test, TF–IDF đạt Precision@5 0,476 và MRR 0,664; baseline đạt Precision@5 0,284. Đây là đánh giá theo nhãn chủ đề, chưa phải chấm liên quan thủ công cho từng bài.

Hệ thống bao gồm hai ứng dụng TypeScript tách riêng khỏi nghiệp vụ phòng khám: một API ở `be/HocMayBE` và một web React ở `fe/HocMayFE`. Script chuẩn bị dữ liệu tải bản gốc, kiểm tra checksum, làm sạch, chia tập, rồi lưu dữ liệu đã xử lý. Script huấn luyện thử bốn cấu hình TF–IDF cùng baseline; cấu hình được chọn dựa trên validation trước khi đánh giá test. API chỉ tải chỉ mục đã lưu, tính vector truy vấn và trả những bài có điểm dương. Giao diện hiển thị điểm cosine dạng số thập phân, đoạn trích và các token đóng góp; điểm số không được trình bày như xác suất đúng.

Kết quả trả lời câu hỏi nghiên cứu trong phạm vi tập dữ liệu này: TF–IDF vượt baseline trên Precision@5 và MRR, thời gian tính điểm thấp khi chỉ mục đã ở bộ nhớ. Chúng tôi không suy rộng kết quả sang bài viết y tế tiếng Việt hoặc cho rằng phương pháp hiểu nghĩa sâu. Giá trị của bài tập là một quy trình có thể tái lập từ dữ liệu thô đến web, trong đó lựa chọn mô hình và phép đánh giá được tách rõ. Phần lớn rủi ro còn lại nằm ở cách định nghĩa mức liên quan và tính phù hợp của dữ liệu nguồn.

## Câu hỏi nghiên cứu

TF–IDF kết hợp cosine có xếp bài viết cùng chủ đề cao hơn baseline trùng từ và đáp ứng đủ nhanh để phục vụ API web trên một kho văn bản nhỏ hay không? Hai tiêu chí được chốt trước khi xem test là Precision@5, MRR và thời gian đáp ứng. Tài liệu cùng chủ đề được xem là liên quan trong phép đo; đây là giả định có giới hạn vì một chủ đề vẫn có nhiều câu hỏi khác nhau.

Đơn vị quan sát là một bài đăng đã làm sạch. Tại thời điểm tìm kiếm, hệ thống biết văn bản của kho train, từ vựng TF–IDF, IDF và truy vấn người dùng. Nhãn chủ đề không tham gia tính điểm; nhãn chỉ xuất hiện trong tệp đánh giá. Đầu ra của một yêu cầu là danh sách nhiều nhất K bài với ID, chủ đề phục vụ bộ lọc, điểm cosine, đoạn trích và các token có tích trọng số lớn nhất. Trường chủ đề trong API là metadata của tập demo, không phải dự đoán của mô hình. Hệ thống từ chối giá trị K ngoài 1–50 và truy vấn trống để tránh xử lý không xác định.

Chúng tôi phân biệt ba loại câu hỏi. Thứ nhất, bài toán sản phẩm là tài liệu nào nên nằm trong trang kết quả đầu tiên. Thứ hai, bài toán thực nghiệm là TF–IDF có thay đổi thứ tự tốt hơn việc đếm từ hay không. Thứ ba, bài toán kỹ thuật là ứng dụng có trả lời nhanh và báo lỗi rõ khi thiếu mô hình hay nhập sai hay không. Precision@5 phản ánh tỷ lệ bài cùng chủ đề trong năm vị trí đầu; MRR phản ánh bài cùng chủ đề đầu tiên xuất hiện sớm hay muộn. Thời gian được đo trong tiến trình tìm kiếm sau khi đã nạp chỉ mục, vì vậy không đại diện cho độ trễ của mạng và trình duyệt.

Tiêu chí thành công tối thiểu là script chạy lại được trên máy khác, không có lỗi fit từ vựng trên validation/test, API trả kết quả có thể giải thích, và có so sánh công bằng với baseline. Nếu TF–IDF không vượt baseline, nhóm vẫn phải trình bày nguyên nhân và sai số; không được thay đổi tập test để đạt kết quả đẹp hơn. Ở lần chạy hiện tại, mô hình vượt baseline nhưng đánh giá còn hạn chế bởi nhãn mức chủ đề. Một truy vấn như “space shuttle launch” có thể liên quan nhiều bài sci.space, trong khi một bài cùng sci.space nói về hành tinh vẫn có thể không giúp người dùng.

## Dữ liệu và sử dụng

Nguồn là bản 20news-bydate được scikit-learn dùng. Ứng dụng viết toàn bộ bằng TypeScript theo yêu cầu tích hợp vào repo hiện tại và tải đúng bản lưu trữ mà scikit-learn công bố, kiểm tra SHA-256 trước khi xử lý. Tám chủ đề gồm đồ họa, phần cứng PC, rao bán, ô tô, bóng chày, y học, không gian và chính sách súng. Đây là bài đăng lịch sử bằng tiếng Anh, không phải nội dung của phòng khám. Dữ liệu thô và nội dung cá nhân không được đưa vào Git.

Tệp lưu trữ được lấy từ URL mà mã nguồn loader của scikit-learn công bố. Script so sánh toàn bộ tệp tải về với SHA-256 `8f1b2514ca22a5ade8fbb9cfa5727df95fa587f4c87b786e15c759fa66d95610`; nếu không khớp thì dừng trước khi giải nén. Cách làm này giảm khả năng vô tình chạy thí nghiệm trên một bản dữ liệu khác. Việc tải chỉ xảy ra khi chưa có bản lưu trữ hợp lệ trong `data/raw`. Đường dẫn dữ liệu không chứa thư mục cá nhân cố định, nên người khác có thể tái tạo trên Windows hoặc môi trường có `tar` tương thích.

Chọn tám chủ đề tạo đủ độ đa dạng để thử sự nhầm lẫn giữa các lĩnh vực mà vẫn giữ chi phí huấn luyện phù hợp với một máy cá nhân. Các nhóm khoa học như `sci.med` và `sci.space` có nhiều từ chuyên môn khác nhau; `comp.graphics` và `comp.sys.ibm.pc.hardware` có thể chia sẻ từ “computer”; `misc.forsale` dễ chứa nhiều tên hàng; chủ đề chính sách súng có thể dùng từ trùng với câu chuyện xã hội ở nhóm khác. Đây là lý do hợp lý để phân tích lỗi theo nhóm, nhưng không có nghĩa tám nhóm này đại diện cho toàn bộ 20 nhóm. Bộ 20 nhóm gốc có 18.846 bài; chỉ số 7.801 trong báo cáo là số bài thuộc tám nhóm được chọn trước bước làm sạch.

Thông tin trên trang scikit-learn mô tả dữ liệu và cách tải nhưng không tự động cấp quyền công bố lại mọi bài đăng. Repo chỉ giữ script tải và metadata nguồn; bản gốc cùng văn bản xử lý được bỏ khỏi Git. Nếu trưng bày công khai bản demo, người vận hành cần xem lại điều khoản nguồn và rà soát bài viết có thông tin cá nhân hoặc nội dung gây hại. Lớp web chỉ hiển thị đoạn trích, trong khi API cũng giới hạn số kết quả. Với bài toán phòng khám, kho dữ liệu cần được thay hoàn toàn bằng nội dung do phòng khám sở hữu hoặc có quyền sử dụng.

## Chất lượng và rò rỉ thông tin

Header có thể chứa chủ đề, email, tên tổ chức hoặc máy chủ và tạo lối tắt cho tìm kiếm. Script loại đoạn header, dòng trích dẫn, chữ ký, email và URL trước khi chia đánh giá. Quy tắc làm sạch được cố định bằng code, không học từ nhãn. Sau chia, bài dưới 40 ký tự bị loại; bản trùng theo SHA-256 của nội dung đã chuẩn hóa được bỏ xuyên split. Chúng tôi không dùng nhãn chủ đề để fit vectorizer.

Lý do loại header là tránh một mô hình tưởng như giỏi nhưng chỉ đọc tên nhóm hoặc địa chỉ máy chủ. Trích dẫn trong bài trả lời có thể lặp nhiều lần cùng văn bản, khiến một tài liệu test vô tình chứa nguyên nội dung đã thấy trong train. Script bỏ các dòng mở đầu bằng dấu trích dẫn phổ biến, phần chữ ký bắt đầu bằng `--`, email và URL trong nội dung. Đây là quy tắc gần đúng; các dạng trích dẫn không có ký hiệu vẫn có thể còn. Bản trình diễn che thêm số điện thoại ở đoạn trích API khi phát hiện mẫu “Phone”, “Tel” hoặc “Fax”. Đó là biện pháp giảm rủi ro hiển thị chứ không phải ẩn danh hoàn chỉnh.

Báo cáo chất lượng được viết sau mỗi lần `data:prepare`. Trong lần chạy này, tổng đầu vào của tám nhóm là 7.801; 99 bài còn dưới 40 ký tự và 27 bài trùng nội dung sau khi làm sạch bị loại. Số còn lại là 7.675, phân bổ vào train, validation và test. Những bài rỗng thường xuất hiện khi phần còn lại chủ yếu là header hoặc trích dẫn. Loại bỏ chúng giúp tránh vector toàn số không và kết quả không có tín hiệu. Dedupe dùng hash của văn bản đã hạ chữ thường; một bài ở train được ưu tiên giữ trước validation, rồi test, để không cho cùng nội dung vượt qua ranh giới đánh giá.

Kiểm tra chất lượng còn cần hiểu giới hạn của phép đo này. Hash chỉ phát hiện bản sao khớp toàn bộ sau chuẩn hóa hiện tại; văn bản thay một câu có thể vẫn gần như trùng. Nội dung sau làm sạch có thể còn tên riêng hoặc dữ liệu nhạy cảm ở dạng không giống email. Phân bố lớp nhìn chung gần cân bằng nhưng không bằng nhau: `talk.politics.guns` còn ít bài nhất, còn `sci.med` nhiều hơn. Chênh lệch đó có thể tác động tới số kết quả cùng chủ đề sẵn có trong chỉ mục. Chúng tôi không cân bằng lại bằng cách nhân bản bài vì thao tác ấy có thể làm sai đánh giá truy hồi.

## Phân chia dữ liệu

Train/test gốc là phân chia theo ngày của 20 Newsgroups. Validation lấy 20% từ train gốc theo từng chủ đề với seed 42. Khi chọn cấu hình, từ vựng và IDF chỉ được fit từ train; truy vấn validation là tài liệu chưa xuất hiện trong chỉ mục. Sau khi chọn, fit lại trên train + validation là hợp lệ vì test vẫn độc lập. Các kiểm thử xác nhận từ chỉ xuất hiện ngoài train không đi vào từ vựng.

Trình tự rất quan trọng: trước tiên xác định bài nào thuộc từng split, sau đó áp dụng quy tắc làm sạch đã chốt và dedupe xuyên split, cuối cùng mới fit thống kê từ vựng. Trong lúc thử tham số, train gồm 3.698 bài. Validation gồm 918 bài, nhưng để giữ thời gian đánh giá và cân bằng các nhóm, script lấy 25 bài đầu sau trộn có seed của mỗi nhóm, tổng 200 truy vấn. Từ mỗi bài validation, script lấy 18 token đầu đã chuẩn hóa làm truy vấn ngắn. Chỉ mục lúc này không chứa bài validation, nên truy vấn không tự tìm thấy chính nó. Cách tạo truy vấn này rẻ và có thể lặp lại, nhưng 18 token đầu không luôn diễn đạt ý chính của bài.

Tập test chính thức có 3.059 bài sau lọc. Khi cấu hình đã chốt, mô hình cuối được fit trên toàn bộ 4.616 bài của train và validation; script lấy 25 bài mỗi nhóm trong test, tổng 200 truy vấn cuối. Dùng lại hàm tạo truy vấn và metric giữ phép so sánh nhất quán với validation, dù kho index lớn hơn ở bước cuối. Báo cáo lưu cấu hình, số chiều và ngày chạy bên cạnh metric để người khác biết kết quả đến từ mô hình nào. Tập test không tham gia điều chỉnh `minDf`, `maxDf`, n-gram hoặc chọn ngưỡng điểm.

Rò rỉ cũng có thể xuất hiện qua thao tác tưởng chừng vô hại như lập danh sách stopword riêng từ toàn bộ tài liệu trước khi chia, chọn nhóm từ dựa trên điểm test, hoặc đọc các câu test để viết truy vấn manual sát với chúng. Phiên bản hiện tại không làm các bước đó: tokenizer là biểu thức cố định, không học stopword từ corpus; danh sách 32 truy vấn tự viết trong tệp độc lập; số liệu test chỉ được sinh bởi lệnh evaluate sau khi có cấu hình chọn ở validation. Kiểm thử tự động còn tạo một token chỉ có ở dữ liệu ngoài train và xác nhận token ấy không lọt vào từ vựng.

## Phương pháp

Baseline chuẩn hóa chữ rồi đếm số token truy vấn có trong mỗi tài liệu, mỗi token tính một lần. TF–IDF đếm tần suất token trong bài, nhân với IDF trơn `log((1+N)/(1+df))+1`, sau đó chuẩn hóa vector về độ dài L2 bằng 1. Điểm cosine giữa truy vấn và tài liệu là tích vô hướng của hai vector đã chuẩn hóa. Hệ thống tạo inverted index từ vector đã lưu để chỉ cộng điểm cho các bài chứa token truy vấn.

Mỗi tài liệu sau khi làm sạch được tách thành token bằng cùng một quy tắc dùng cho truy vấn. Những token xuất hiện trong quá ít bài bị loại bởi `minDf`, còn token quá phổ biến bị loại bởi `maxDf`. Tần suất tài liệu `df` được đếm đúng một lần cho mỗi bài, dù từ xuất hiện lặp lại trong bài đó. IDF trơn đảm bảo từ có trong toàn bộ kho vẫn có trọng số hữu hạn. Trọng số TF–IDF của từ trong tài liệu là tích giữa số lần xuất hiện và IDF. Sau chuẩn hóa L2, một bài dài không thắng chỉ vì chứa nhiều từ hơn. Nếu mọi token đều bị lọc, vector rỗng và hệ thống trả danh sách rỗng thay vì bịa điểm.

Ở thời điểm chuẩn bị mô hình, chỉ mục nghịch đảo lưu với mỗi token danh sách cặp `(documentId, weight)`. Khi có truy vấn, hệ thống dùng từ vựng và IDF đã lưu để tạo vector truy vấn, rồi duyệt posting list của các token còn lại. Mỗi tích `weightQuery × weightDocument` được cộng vào điểm tài liệu tương ứng. Hai vector đã chuẩn hóa nên tổng đó là cosine. Chỉ những bài có ít nhất một token chung nhận điểm dương; cuối cùng sắp giảm theo điểm, dùng ID để phá hòa ổn định. Như vậy một yêu cầu tìm kiếm không cần vector hóa lại cả kho và không cần tính tích vô hướng với mọi tài liệu.

Baseline nhận cùng chuỗi truy vấn đã chuẩn hóa. Mỗi từ truy vấn khác nhau được cộng một điểm nếu xuất hiện trong bài. Cách này có thể ưu tiên bài chứa nhiều từ truy vấn nhưng không phân biệt từ đặc trưng với từ rất phổ biến; bài lặp một từ nhiều lần cũng không được lợi. Baseline vẫn có ích vì đơn giản, dễ diễn giải và cho biết liệu trọng số IDF cùng chuẩn hóa có thực sự đem lại cải thiện trong thí nghiệm hay không. Cả hai hệ thống dùng cùng kho chỉ mục ở từng split và cùng quy tắc gán nhãn liên quan khi tính metric.

Điểm cosine nằm trong khoảng 0–1 với vector không âm đã chuẩn hóa, nhưng không phải xác suất bài đúng. Một bài có điểm 0,56 chỉ có nghĩa hướng vector từ vựng của nó gần với hướng vector truy vấn hơn các bài có điểm thấp trong cùng chỉ mục. Giá trị tuyệt đối có thể thay đổi khi thêm tài liệu, đổi từ vựng hoặc thay độ dài truy vấn. Giao diện vì vậy hiển thị điểm thập phân cùng các token đóng góp lớn nhất để người dùng hiểu vì sao bài xuất hiện; hệ thống không dùng một ngưỡng điểm cố định để tuyên bố đúng hay sai.

## Thiết kế thí nghiệm

Các phương án dùng cùng train, cùng 200 truy vấn validation và cùng phép đo: baseline; unigram; unigram + bigram; giảm `minDf` từ 3 xuống 2; tăng `minDf` lên 5 và giảm `maxDf` xuống 0,85. Số chiều từ vựng được báo cùng điểm, tránh đánh đổi chất lượng lấy bộ từ vựng quá lớn mà không thấy chi phí. Chọn theo Precision@5, dùng MRR để phá hòa, sau đó ưu tiên mô hình nhỏ hơn.

Phép đo Precision@5 lấy năm kết quả đầu cho một truy vấn, đếm bao nhiêu bài có cùng nhãn chủ đề với bài truy vấn, rồi chia cho năm. Trung bình trên 200 truy vấn cho biết hiệu quả của trang kết quả đầu tiên. MRR lấy nghịch đảo vị trí của bài cùng chủ đề xuất hiện đầu tiên; nếu không có bài như vậy thì bằng 0. MRR nhấn mạnh vị trí đầu, còn Precision@5 phản ánh mật độ kết quả liên quan. Cả hai là metric tự động theo nhãn chủ đề, không thay được đánh giá từng cặp truy vấn–tài liệu của con người.

Các truy vấn validation và test được chọn bằng cùng seed, 25 bài mỗi nhóm. Lấy 18 token đầu làm đầu vào mô phỏng một câu tìm kiếm ngắn; mục tiêu là cố định phép đo để so sánh cấu hình, không khẳng định đây là hành vi tìm kiếm thật. K được cố định ở 5 trong đánh giá chính. Không chọn K bằng test; giao diện vẫn cho phép K khác nhau như một tham số sản phẩm. Bốn phương án TF–IDF khác nhau ở lượng từ hiếm giữ lại, lượng từ phổ biến bỏ đi và việc thêm bigram. Bigram có thể bắt cụm nghĩa như “space shuttle”, nhưng cũng làm không gian đặc trưng thưa hơn và tăng kích thước chỉ mục.

Độ trễ được đo quanh lệnh tìm kiếm trong cùng tiến trình Node sau khi nạp model. Script chạy các truy vấn, lấy trung vị và phân vị 95 để tránh một vài truy vấn dài che mất hành vi thông thường. Kết quả không tính tải dữ liệu từ đĩa lúc khởi động, HTTP, proxy Vite, mạng hay trình duyệt. Vì thế số mili giây chỉ là bằng chứng rằng thuật toán tìm kiếm phù hợp quy mô demo; nó không phải cam kết vận hành trong hệ thống phòng khám. Máy, phiên bản Node, tải hệ thống và kích thước chỉ mục có thể làm số này thay đổi.

## Truy vấn tự xây dựng

Tệp `data/manual-queries.json` có 32 câu truy vấn ngắn, bốn câu mỗi chủ đề. Mỗi câu có một chủ đề được gán là liên quan. MRR và Precision@5 được tính theo chủ đề của bài được trả về. Bộ câu này dễ hơn truy vấn rút từ bài test vì tác giả viết trực tiếp từ các từ khóa chủ đề; kết quả phải báo tách riêng, không dùng để thay điểm test. Để đánh giá ứng dụng thực tế, cần người chấm đọc từng kết quả và đánh dấu bài thực sự trả lời câu hỏi.

Ví dụ truy vấn thuộc chủ đề không gian nhắc đến chuyến bay và kính thiên văn; chủ đề y học hỏi về điều trị, triệu chứng hoặc nghiên cứu; chủ đề phần cứng PC hỏi linh kiện và cấu hình. Các câu được lưu riêng trong JSON với ID, câu chữ và nhãn dự kiến để người xem có thể đọc, sửa và mở rộng mà không thay thuật toán. Chúng không được sinh từ nội dung một tài liệu cụ thể và không dùng để fit IDF. Bốn câu mỗi lớp giúp phát hiện trường hợp một lớp chỉ tình cờ có một ví dụ tốt, dù số lượng vẫn nhỏ so với bộ đánh giá thực tế.

Điểm P@5 của bộ truy vấn thủ công là 0,881 và MRR là 0,941. Sự chênh lệch lớn so với test tự động là một phát hiện cần giải thích: câu tự viết thường chứa chính thuật ngữ phân biệt chủ đề, trong khi 18 token đầu của một bài đăng có thể là lời chào hoặc bối cảnh. Nếu chỉ công bố điểm 0,881, người xem sẽ đánh giá quá cao hệ thống. Chúng tôi giữ điểm này như phép kiểm tra giao diện và khả năng truy hồi câu hỏi rõ nghĩa; kết luận chính lấy từ split test độc lập với cấu hình.

Một bộ đánh giá sử dụng thật nên trích câu hỏi từ nhật ký tìm kiếm đã được phép dùng, sau đó cho ít nhất hai người đọc và chấm mức liên quan của từng kết quả. Bất đồng cần được lưu và giải quyết trước khi tính metric. Với bài y tế, câu trả lời vừa phải đúng chủ đề vừa phải chính xác, có nguồn và còn hiệu lực. Nhãn `sci.med` chỉ chỉ ra diễn đàn mà bài được đăng; nó không bảo đảm bài đó đáng tin cho bệnh nhân.

## Kết quả validation

Baseline đạt Precision@5 0,294. Unigram đạt 0,469 và đứng đầu. Unigram + bigram đạt 0,425; biến thể `minDf=2` đạt 0,434; biến thể `minDf=5`, `maxDf=0,85` đạt 0,402. Bigram làm tăng đáng kể số chiều nhưng không cải thiện điểm trên tập này. Vì vậy, mô hình unigram được chốt trước khi chạy test. Điểm manual query không dùng để đổi lựa chọn mô hình.

So với baseline, unigram tăng tuyệt đối 0,175 điểm Precision@5 trên validation. Diễn giải trên năm vị trí đầu, mức tăng này tương đương gần 0,9 bài cùng chủ đề cho mỗi truy vấn trong mẫu đo. Đây là chênh lệch thực nghiệm trên tập cụ thể; chưa có khoảng tin cậy hoặc phép thử ý nghĩa thống kê nên không nên suy rộng thành một quy luật cho mọi tập văn bản. MRR của các phương án cũng được lưu trong `results.json` để xem liệu cải thiện P@5 có đi cùng việc đẩy kết quả đầu lên cao hay không.

Biến thể `minDf=2` giữ nhiều từ hiếm hơn, làm tăng số chiều từ vựng. Từ hiếm có thể giúp nhận dạng một tên sản phẩm hay thuật ngữ kỹ thuật, nhưng cũng có nhiều lỗi gõ và tên riêng chỉ xuất hiện một vài lần. Trong mẫu validation này, lợi ích không bù được nhiễu. Biến thể `minDf=5`, `maxDf=0,85` lọc gắt hơn, tạo chỉ mục nhỏ hơn nhưng có thể mất những token hữu ích cho truy vấn cụ thể. Kết quả 0,402 cho thấy việc giảm số chiều quá mạnh đã làm chất lượng thấp hơn cấu hình chuẩn trong điều kiện này.

Unigram + bigram cũng thấp hơn unigram, dù về mặt ngôn ngữ có vẻ giàu biểu diễn hơn. Một lý do có thể là mỗi cụm hai từ chỉ xuất hiện ở ít bài, và truy vấn 18 token đầu không luôn lặp đúng cụm từ ở tài liệu phù hợp. Bigram còn làm mỗi tài liệu và truy vấn có nhiều đặc trưng, kéo theo chi phí lưu trữ và tính điểm. Thí nghiệm không chứng minh bigram luôn kém; nó chỉ cho thấy chưa có lý do chọn bigram cho chỉ mục và bộ câu hỏi hiện tại. Nếu đổi sang bài tiếng Việt, tách từ và cụm từ sẽ phải được thiết kế lại từ đầu.

## Kết quả test

Trên 200 truy vấn từ tài liệu test, unigram TF–IDF có Precision@5 0,476 và MRR 0,664. Baseline trùng từ đạt Precision@5 0,284 và MRR 0,495. Trung vị thời gian tìm kiếm là 2,9 ms, P95 6,1 ms trên môi trường thử nghiệm. Đây là thời gian trong hàm xếp hạng sau khi mô hình đã nạp; không gồm thời gian tải trang, mạng hoặc khởi động server. Không nên suy ra SLA production từ phép đo này.

Mức tăng tuyệt đối trên test là 0,192 Precision@5 và 0,169 MRR. Với cùng định nghĩa liên quan theo nhãn chủ đề, trung bình trong năm kết quả đầu có thêm khoảng 0,96 bài cùng chủ đề so với baseline. MRR 0,664 cho thấy bài cùng chủ đề đầu tiên thường xuất hiện khá sớm, nhưng giá trị trung bình che giấu các truy vấn không có kết quả phù hợp ở đầu. Bảng theo từng chủ đề trong phần phân tích lỗi giúp tránh diễn giải một con số chung như mức chất lượng đồng đều cho mọi lĩnh vực.

Kết quả trên test gần validation của cấu hình đã chọn, với P@5 chênh 0,007. Đây là dấu hiệu tích cực về tính ổn định qua hai split, nhưng hai tập vẫn cùng nguồn 20 Newsgroups và cùng quy tắc sinh truy vấn. Không thể dùng chênh lệch nhỏ này để khẳng định hệ thống sẽ hoạt động tương tự trên dữ liệu phòng khám, câu hỏi tiếng Việt hoặc tài liệu ngắn hơn. Một thử nghiệm mới trên corpus phòng khám cần được thiết kế độc lập với báo cáo này và phải có quy trình quản lý dữ liệu phù hợp.

Đánh giá thủ công 32 câu đạt P@5 cao hơn đáng kể; báo cáo giữ hai con số ở hai mục riêng để người đọc nhìn thấy tác động của cách tạo truy vấn. Với các câu rất rõ chủ đề, tín hiệu IDF có nhiều cơ hội phát huy. Ngược lại, một câu hỏi người dùng ngắn, dùng từ đồng nghĩa không có trong kho, sẽ khó cho TF–IDF dù ý nghĩa phù hợp. Phép đo tốc độ cũng cần nhìn cùng kích thước index: mô hình cuối có 4.616 tài liệu và từ vựng 14.135 token, tương đối nhỏ so với một hệ thống sản xuất.

## Phân tích lỗi

Nhóm bóng chày có Precision@5 thấp nhất trong mẫu test (0,376); chính sách súng đạt 0,408. Một số đoạn mở đầu bài viết chỉ chứa lời dẫn hay trích dẫn hội thoại, không đủ tín hiệu chủ đề cho truy vấn rút tự động. Một số từ phổ biến xuất hiện ở nhiều nhóm, khiến bài khác chủ đề đứng đầu. Đây là giới hạn của truy vấn ngắn và đánh giá bằng nhãn chủ đề, không chứng minh mọi bài đứng sai đều vô ích với người đọc.

Phân tích theo lớp được thực hiện trên cùng 25 truy vấn test mỗi lớp, nên một truy vấn thất bại có thể làm số trung bình lớp thay đổi đáng kể. Bóng chày là ví dụ: tên cầu thủ, đội bóng hoặc chuyện cá nhân ở đầu bài có thể hiếm gặp trong tài liệu khác, khiến vector truy vấn không kết nối rõ với nhãn `rec.sport.baseball`. Truy vấn tự động cũng có thể bắt đầu bằng lời dẫn chung trước khi văn bản nói đến trận đấu. Với `talk.politics.guns`, từ “law”, “right” hoặc “government” có thể xuất hiện trong nhiều chủ đề xã hội khác, còn từ đặc trưng nằm sâu hơn trong bài.

Một nhóm lỗi khác đến từ làm sạch. Loại dòng trích dẫn giảm rò rỉ, nhưng đôi khi phần trích dẫn lại chứa câu hỏi chính, trong khi phần tác giả trả lời chỉ là “I agree” hoặc một lời nhận xét ngắn. Quy tắc cắt chữ ký có thể loại quá nhiều hoặc quá ít nếu văn bản dùng định dạng khác. Vấn đề này cần được giải quyết bằng cách xem các cặp truy vấn–kết quả sai, cải thiện parser, rồi kiểm thử trên một tập đánh giá mới. Không nên tinh chỉnh lại trên chính test hiện tại vì sẽ làm điểm test mất tính độc lập.

Điểm theo chủ đề không phát hiện các bài khác nhãn nhưng vẫn trả lời đúng câu hỏi. Ví dụ một câu về phần cứng dùng trong đồ họa có thể được giải đáp ở cả nhóm `comp.graphics` và `comp.sys.ibm.pc.hardware`; phép đo hiện tại vẫn xem một bên là sai. Ngược lại, một bài đúng nhãn nhưng không nói về truy vấn cụ thể sẽ được xem là đúng. Đây là lý do báo cáo dùng từ “cùng chủ đề” khi nói về metric, và đề xuất gắn nhãn mức bài bởi người đọc ở giai đoạn tiếp theo. Giao diện cũng không ẩn điểm thấp để người dùng có thể tự xem các kết quả gần nhất và nhận biết khi kho không có câu trả lời.

## Web và API

Backend TypeScript phục vụ `GET /api/search?q=&k=&category=`, `GET /api/meta`, `GET /api/evaluation`, `GET /api/health`. API kiểm tra độ dài truy vấn, số kết quả và chủ đề; trả 400 cho đầu vào sai, 503 khi chưa có mô hình. Frontend React có ba màn hình: giới thiệu/phạm vi, thao tác tìm kiếm và dashboard đánh giá. Trang kết quả cho thấy đoạn trích, điểm cosine, các token góp phần và thời gian đáp ứng. Backend chỉ nạp chỉ mục đã huấn luyện từ tệp, không fit trên mỗi request.

Luồng chạy bắt đầu bằng `npm run pipeline` tại BE: chuẩn bị dữ liệu, kiểm tra checksum, tách split, thử các cấu hình, chọn mô hình và lưu chỉ mục. Khi server khởi động, nó đọc model cùng metadata và nạp posting list vào bộ nhớ. FE gọi API qua proxy khi phát triển hoặc qua cấu hình endpoint khi triển khai. Một truy vấn đi qua kiểm tra tham số, tokenizer và vector truy vấn, phép cộng điểm theo posting list, sắp hạng, cắt K rồi tạo đoạn trích. Không có bước tính IDF trên request. Khi dữ liệu nguồn thay đổi, người vận hành chạy lại pipeline và khởi động lại BE để nạp model mới.

Giao diện tìm kiếm có trường nhập, bộ lọc tám chủ đề và lựa chọn số lượng kết quả. Mỗi thẻ kết quả có tiêu đề rút từ bài, tên nhóm, đoạn trích, điểm cosine và các từ góp phần. Giao diện hiển thị trạng thái đang tải, lỗi API, không có kết quả và kết quả thành công. Màn hình giới thiệu giải thích phạm vi dữ liệu cùng nguyên lý; màn hình đánh giá đưa các số liệu validation/test và một biểu đồ so sánh để người xem kiểm tra kết luận. Các thành phần dùng HTML có nhãn và điều hướng bằng bàn phím ở mức cơ bản. Điểm trình bày tới ba chữ số thập phân, có giải thích không phải xác suất.

API trả JSON và không yêu cầu đăng nhập vì đây là demo trên dữ liệu công khai. Đối với phòng khám thật, không nên mở endpoint này ra Internet trước khi có xác thực, giới hạn tốc độ và phân quyền theo loại tài liệu. Chỉ mục demo là một dịch vụ độc lập trong `be/HocMayBE`; chưa nối Gateway/Clinic Service để tránh làm thay đổi luồng bệnh án hiện tại. Điểm tích hợp hợp lý là Gateway chuyển tiếp yêu cầu tìm kiến thức y tế tới dịch vụ tìm kiếm, còn dữ liệu bệnh án cá nhân phải theo chính sách truy cập riêng. Cần thay corpus bằng các bài được duyệt, không dùng bài `sci.med` như lời khuyên điều trị.

## Đạo đức và giới hạn

20 Newsgroups gồm bài đăng của người thật, có thể chứa quan điểm lỗi thời, nội dung nhạy cảm và thông tin cá nhân. Pipeline bỏ email/header/đoạn trích dẫn và chỉ hiển thị đoạn ngắn, nhưng cần rà soát thêm nếu công bố rộng. Dữ liệu `sci.med` không phải nguồn y khoa được thẩm định. Điểm cosine là độ giống từ vựng, không phải xác suất đúng hoặc chẩn đoán. Chuyển sang phòng khám cần kho bài tiếng Việt do người có chuyên môn duyệt, thử nghiệm truy vấn tiếng Việt và cơ chế phân quyền nếu tìm trong tài liệu nội bộ.

Nguồn 20 Newsgroups được tạo từ thảo luận trên Internet thời kỳ trước; một số bài có thể có ngôn ngữ không phù hợp hoặc thông tin lỗi thời. Hệ thống tìm kiếm có thể vô tình làm nội dung đó nổi bật khi người dùng nhập truy vấn. Vì vậy, nếu trình bày công khai, nhóm nên giới hạn đối tượng truy cập, thêm hướng dẫn sử dụng và cơ chế báo cáo bài cần gỡ. Việc bỏ email, URL và số điện thoại ở snippet giảm một số trường hợp lộ dữ liệu nhưng không loại mọi tên người, địa chỉ hoặc câu chuyện cá nhân. Không được mô tả pipeline này là công cụ ẩn danh hoàn chỉnh.

Sai lệch trong dữ liệu ảnh hưởng trực tiếp thứ hạng. Các chủ đề được chọn có thể có lượng bài và cách viết khác nhau; những nhóm có nhiều thuật ngữ lặp lại sẽ dễ được TF–IDF nhận ra hơn. Cấu hình chọn theo điểm trung bình có thể tối ưu cho nhóm dễ và che khuất nhóm khó. Bảng P@5 theo từng nhóm là bước kiểm tra ban đầu; muốn ra quyết định sản phẩm cần phân tích thêm theo kiểu truy vấn, độ dài văn bản, ngôn ngữ và độ tin cậy nguồn. Việc lưu cấu hình cùng kết quả cho phép so sánh trung thực giữa các phiên bản mà không thay đổi định nghĩa metric sau khi xem kết quả.

Ứng dụng phòng khám đặt ra yêu cầu cao hơn nhiều: bài hướng dẫn phải được bác sĩ hoặc bộ phận chuyên môn duyệt, có ngày cập nhật, nguồn tham khảo, phạm vi đối tượng và quy trình thu hồi nội dung sai. Tìm kiếm chỉ giúp người dùng tới bài phù hợp; nó không chẩn đoán và không thay tư vấn cá nhân. Khi truy vấn nhắc triệu chứng hoặc thuốc, giao diện cần ngữ cảnh rõ để tránh người dùng hiểu điểm cosine là mức độ an toàn hay phù hợp điều trị. Việc tìm trong hồ sơ bệnh nhân còn đòi hỏi xác thực và ghi nhật ký truy cập trước khi đưa vào thực tế.

## Tái lập và bàn giao

Node 24+, npm 11+, `tar` và kết nối mạng là các yêu cầu đầu vào. `npm ci`, `npm run pipeline`, `npm run dev` dựng lại backend; `npm ci`, `npm run dev` trong `fe/HocMayFE` khởi động web. Script kiểm tra SHA-256, seed, cấu hình, split và kết quả. Các test của BE kiểm tra làm sạch, phép cosine, leakage ở từ vựng và schema API. Tên hai thành viên, phân công và nhật ký sáu tuần cần điền đúng theo Git history, không suy diễn từ mã nguồn hiện tại.

Một người kiểm tra lại cần bắt đầu từ README của hai module. Sau khi cài dependency bằng lockfile, lệnh pipeline tải gói nguồn nếu chưa có, xác thực checksum, sinh `quality.json`, chọn cấu hình trên validation, lưu model rồi xuất `results.json` và các biểu đồ SVG. Lệnh typecheck, test và build xác minh mã TypeScript; tiếp theo khởi động BE, FE và thử một truy vấn đại diện như “space shuttle launch mission”. Kết quả cụ thể có thể thay đổi nhỏ ở thời gian đo vì phần cứng và tải máy, còn số split, số chiều, P@5 và MRR phải lặp lại nếu cùng dữ liệu và seed.

Các tệp raw, processed và model có thể lớn và có nội dung của người đăng nên bị bỏ khỏi Git; script và chỉ dẫn dựng lại được giữ. Báo cáo lưu nguồn dữ liệu, checksum, ngày chạy và kết quả chính. Khi bàn giao nội bộ, có thể đóng gói model theo quy định của đơn vị nếu có quyền lưu và phân phối dữ liệu; nếu không, người nhận tự chạy pipeline từ nguồn. Ứng dụng FE và BE không phụ thuộc thư mục khác của hệ thống phòng khám, nên reviewer có thể chạy demo mà không cần khởi động Gateway, CSDL hay các dịch vụ khám bệnh.

Nhật ký tiến độ và phân công là bằng chứng hoạt động của nhóm, không phải số liệu mô hình. Do phiên làm việc hiện tại không có danh tính hoặc lịch sử đóng góp của hai người, báo cáo để ô trống thay vì tạo thông tin giả. Mẫu nhật ký sáu tuần trong thư mục `reports` nêu các hạng mục cần điền và yêu cầu gắn với commit, ảnh chụp hoặc biên bản thực tế. Trước khi nộp, nhóm cần đọc lại từng câu trong báo cáo, điều chỉnh lời xưng “chúng tôi” theo công việc đã làm và bổ sung công cụ AI đã dùng theo quy định của học phần.

## Kết luận

Với 8 chủ đề của 20 Newsgroups, TF–IDF unigram vượt baseline trùng từ trên Precision@5 của test và cho phản hồi nhanh trên máy thử nghiệm. Kết quả phù hợp mục tiêu một công cụ tìm kiếm nhỏ, minh bạch và không cần mô hình ngôn ngữ lớn. Hạn chế quan trọng là đánh giá cùng chủ đề thay cho mức liên quan từng bài và mô hình chỉ khớp từ vựng tiếng Anh. Trước khi đưa vào cổng bệnh nhân, cần dữ liệu được duyệt và đánh giá riêng cho tiếng Việt.

Bài tập đã đi hết quy trình từ dữ liệu thô có checksum tới sản phẩm tương tác: tách split, làm sạch, xây chỉ mục, chọn siêu tham số trên validation, so sánh baseline, đánh giá test và phục vụ qua API. Phần có giá trị nhất về mặt phương pháp là tách thời điểm học từ vựng khỏi thời điểm đánh giá và tách chỉ mục đã huấn luyện khỏi xử lý mỗi yêu cầu. Điều này vừa làm phép đo đáng tin hơn vừa giữ độ trễ API thấp. Kết quả kiểm thử tự động và thao tác trên trình duyệt cho thấy đường đi cơ bản từ truy vấn tới danh sách bài hoạt động.

Hướng mở rộng có cơ sở là gắn nhãn liên quan mức từng bài, cải thiện cách sinh truy vấn đánh giá, thử BM25 và xử lý đồng nghĩa, sau đó kiểm chứng trên corpus tiếng Việt được phép sử dụng. Mỗi mở rộng phải giữ một tập kiểm thử mới độc lập để tránh tối ưu vào tập test đã đọc. Khi đưa vào kiến trúc phòng khám, dịch vụ tìm kiếm nên nhận bài kiến thức từ nguồn đã duyệt và cung cấp API qua Gateway; các tài liệu nội bộ chỉ được lập chỉ mục với kiểm soát quyền truy cập tương ứng. Những bước này nằm ngoài phạm vi kết quả thực nghiệm hiện tại.

## Tài liệu tham khảo

1. scikit-learn, “The 20 newsgroups text dataset”: https://scikit-learn.org/stable/datasets/real_world.html#the-20-newsgroups-text-dataset
2. scikit-learn, mã nguồn loader và checksum: https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/datasets/_twenty_newsgroups.py
3. scikit-learn, “Text feature extraction”: https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction
4. Tài liệu học phần, Bài 1 – Vector và độ tương đồng cosine (do giảng viên cung cấp).

## Phụ lục cần nhóm hoàn thiện

- Điền họ tên, mã sinh viên, lớp và phân công hai thành viên.
- Ghi nhật ký sáu tuần theo công việc thực tế; đối chiếu với commit và pull request.
- Ghi công cụ AI đã sử dụng và cách kiểm chứng kết quả theo yêu cầu học vụ.
- Thêm đánh giá thủ công mức từng bài nếu còn thời gian; giữ tập test độc lập với việc chọn tham số.
