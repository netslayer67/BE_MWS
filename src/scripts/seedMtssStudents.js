const mongoose = require('mongoose');
const MTSSStudent = require('../models/MTSSStudent');
require('dotenv').config();

const RAW_DATA = String.raw`
Full Name	Nick Name	Gender	Current status	Student MWS Email	Current grade (If Active)	Class Name	Join Academic year
Mafesia Fihir	Mafe	Female	Active	mafesia.fihir@millennia21.id	Grade 1	Grade 1 - Barnard's	2024/2025
Afzal Isfandiyar Adam	Afzal	Male	Active	afzal.adam@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Narinka Keshwari Arunika	Narinka	Female	Active	narinka.arunika@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Narendratama Prabandaru Mansursyah	Naren	Male	Active	narendratama.mansursyah@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Makara Aiyana Kumbara	Makara	Female	Active	makara.kumbara@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Gallendra Abqory Suseno	Gallen	Male	Active	gallendra.suseno@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Rex Syailendra Pongki	Rex	Male	Active	rex.pongki@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Karanada Padmi Amidala	Karanada	Female	Active	karanada.amidala@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Matthew Raphael Botschaft Lubis	Matthew	Male	Active	matthew@millennia21.id	Grade 1	Grade 1 - Centaurus	2022/2023
Gamayka Kenzo Parvaiz	Mayka	Male	Active	gamayka.parvaiz@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Reina Deluna Ramadhani	Luna	Female	Active	reina.ramadhani@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Umar Fattah Brawijaya	Umar	Male	Active	umar.brawijaya@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Syafiqa Mahreen Hafizhah	Syafiqa	Female	Active	syafiqa.hafizhah@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Arkana Adja Radeva	Arkana	Male	Active	arkana.radeva@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Adiva Afshin Myesha	Adiva	Female	Active	adiva.afshin@millennia21.id	Grade 1	Grade 1 - Barnard's	2024/2025
Ocean Binar Malaia	Ocean	Female	Active	ocean.binar@millennia21.id	Grade 1	Grade 1 - Centaurus	2024/2025
Sakha Askaramurti	Aska	Male	Active	sakha.askar​amurti@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Mikhail Arshaka Wahyudi	Shaka	Male	Active	mikhail.wahyudi@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Brahayu Krisna Atyasa	Krisna	Male	Active	brahayu.atyasa@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Auristela Annasya Sitompul	Asya	Female	Active	auristela.annasya@millennia21.id	Grade 1	Grade 1 - Centaurus	2024/2025
Arsyakayla Dirra Kencana	Arsya	Female	Active	arsyakayla.kencana@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Olivia Judith Hutasoit	Olivia	Female	Active	olivia@millennia21.id	Grade 1	Grade 1 - Barnard's	2023/2024
Daniza Elina Dhira Azana	Daniza	Female	Active	daniza.azana@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Radeva Ishvara Pramudita	Deva	Male	Active	radeva.pramudita@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Komang Vidya Anjani	Anjani	Female	Active	komang@millennia21.id	Grade 1	Grade 1 - Barnard's	2023/2024
Syayidah Nur Humaira	Aira	Female	Active	syayidah.humaira@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Nidrina Chelyn Findriawan	Chelyn	Female	Active	nidrina@millennia21.id	Grade 1	Grade 1 - Barnard's	2023/2024
Rumaisa Magali Budi	Magali	Female	Active	magali.budi@millennia21.id	Grade 1	Grade 1 - Centaurus	2022/2023
Ellyca Nomi Suyoto	Ellyca	Female	Active	ellyca.nomi@millennia21.id	Grade 1	Grade 1 - Centaurus	2024/2025
Daniil Gabriel Shihab	Daniil	Male	Active	daniil@millennia21.id	Grade 1	Grade 1 - Barnard's	2024/2025
Kanyaka Aufaa Lituhayu	Kanyaka	Female	Active	kanyaka.lituhayu@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Fairel Prajna Rasyid	Fairel	Male	Active	fairel.prajna@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Alya Kayyisa Humaira	Alya	Female	Active	alya.humaira@millennia.id	Grade 1	Grade 1 - Centaurus	2025/2026
Imani Soleil Jahja	Imani	Female	Active	imani.jahja@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Raidan Mauly Kareem	Aidan	Male	Active	raidan@millennia21.id	Grade 1	Grade 1 - Centaurus	2023/2024
Alexa Humaira Putri Budiman	Alexa	Female	Active	alexa.budiman@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Alanis Kamaniya Rahmi	Alanis	Female	Active	alanis@millennia21.id	Grade 1	Grade 1 - Barnard's	2022/2023
Valeo Akira Sachdev	Valeo	Male	Active	valeo.sachdev@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Gemintang Anjani Mustafa	Anjani	Female	Active	gemintang.mustafa@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Runa Araima Wirawan	Mima	Female	Active	runa@millennia21.id	Grade 1	Grade 1 - Centaurus	2023/2024
Muhammad Zayn	Zayn	Male	Active	muhammad.zayn@millennia21.id	Grade 1	Grade 1 - Barnard's	2024/2025
Mabbina Zalfaasha	Bina	Female	Active	mabbina.zalfaasha@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Kayana Asshauqi Mannan	Kayana	Male	Active	kayaka.manan@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Shaqueena Gea Budisanjaya	Gea	Female	Active	shaqueena.sanjaya@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Alchemy Kailashalbie Meliala	kail	Male	Active	Alchemy.Kailashalbie@millennia21.id	Grade 1	Grade 1 - Centaurus	2024/2025
Andi Nala Afsheena	Nala	Female	Active	andi.afsheena@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Lateesha Giev Shyandel	Giev	Female	Active	lateesha.shyandel@millennia21.id	Grade 1	Grade 1 - Centaurus	2025/2026
Arshavin Abhinaya	Shavin	Male	Active	arshavin@millennia21.id	Grade 1	Grade 1 - Centaurus	2023/2024
Gembira Dewananda Abinaya	Gembira	Male	Active	gembira@millennia21.id	Grade 1	Grade 1 - Centaurus	2022/2023
Florianne Saidyara Sulistyawan	Joji	Female	Active	florianne.saidyara@millennia21.id	Grade 1	Grade 1 - Barnard's	2024/2025
Miyarsa Sema Ruyi	Sema	Male	Active	miyarsa.ruyi@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Ragnar Abdulghani Biwantha	Ragnar	Male	Active	ragnar@millennia21.id	Grade 1	Grade 1 - Barnard's	2023/2024
Zoey Ivanna Simangunsong	Zoey	Female	Active	zoey@millennia21.id	Grade 1	Grade 1 - Centaurus	2023/2024
Runako Neva Salman	Neva	Male	Active	runako@millennia21.id	Grade 1	Grade 1 - Barnard's	2023/2024
Nicholas Ragnala Banyu Agrapana	Banyu	Male	Active	nicholas.agrapana@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Sasikalia Maisa Safandhi	Sasi	Female	Active	sasi@millennia21.id	Grade 1	Grade 1 - Barnard's	2022/2023
Radeva Ehuara Sembiring	Radeva	Male	Active	radeva.sembiring@millennia21.id	Grade 1	Grade 1 - Barnard's	2025/2026
Levine Othniel Calogero	Levine	Male	Active	levine@millennia21.id	Grade 1	Grade 1 - Centaurus	2023/2024
Kalandra Asha Janitra	Asha	Female	Active	"kalandra@millennia21.id
"	Grade 1	Grade 1 - Barnard's	2023/2024
Ragasancaya Prahasambodhana	Ragasa	Male	Active	raga@millennia21.id	Grade 2	Grade 2 - Skyrocket	2022/2023
Raline Fajria Jelita	Raline	Female	Active	raline.fajria@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Prisha Adelia Meizarwan	Adelia	Female	Active	prisha.adelia@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Ignatius Axl Dikamasei Sarira	Sei	Male	Active	ignatius@millennia21.id	Grade 2	Grade 2 - Fireworks	2023/2024
Aqeela Rumaisha Prasetyo	Aqeela	Female	Active	aqeela.rumaisha@millennia.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Fazeela Shazva Pratama	Fazeela	Female	Active	fazeela.shazva@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Axaquille Kafeel Mubarak	Kafeel	Male	Active	axaquille.kafeel@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Askiara Latisha Sitorus	Kia	Female	Active	askiara.latisha@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Mika Rashi Sabira Erhan	Mika	Female	Active	mika.rashi@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Shabiya Adifa Permana	Biya	Female	Active	shabiya.adifa@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Andrew Tarbin Darien Fattah	Andrew	Male	Active	andrew.tarbin@millennia21.id	Grade 2	Grade 2 - Fireworks	2023/2024
Rajendra Rafka Ramadhan	Rajendra	Male	Active	rajendra.rafka@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Puti Mayra Kanahaya	Puti	Female	Active	puti@millennia21.id	Grade 2	Grade 2 - Skyrocket	2023/2024
Muhammad Arkan Nofrisal	Arkan	Male	Active	muhammad.arkan@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Aisya Namira Yordan	Namira	Female	Active	aisya.namira@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Alesha Zahira	Alesha	Female	Active	alesha.zahira@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Hamish Khalif Achtar	Hamish	Male	Active	hamish@millennia21.id	Grade 2	Grade 2 - Skyrocket	2022/2023
Rashad Rafisqy Prayitno	Rashad	Male	Active	rasyad.rafisqy@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Gema Tyaga Soesetyo	Aga	Male	Active	gema@millennia21.id	Grade 2	Grade 2 - Fireworks	2023/2024
Reynandra Arshaka Widayanto	Rey	Male	Active	reynandra.arshaka@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Felicia Almirazachrania Sudradjat	Felicia	Female	Active	felicia@millennia21.id	Grade 2	Grade 2 - Fireworks	2022/2023
Yang Garis Saharsa	Garis	Female	Active	yang.garis@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Narendra Paramasatya Mansur	Rama	Male	Active	naren@millennia21.id	Grade 2	Grade 2 - Fireworks	2022/2023
Alessandra Lily Anne	Lily	Female	Active	alessandra.lily@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Salwa Nada Yara	Salwa	Female	Active	salwa.nada@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Mikail Aldebaran Darmawan	Mikail	Male	Active	mikail.aldebaran@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Sukainah Shafura Alatas	Nasha	Female	Active	sukainah.shafura@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Qiana Shema Alesha	Qiana	Female	Active	qiana.shema@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Daninda Farzana Ardian	Danin	Female	Active	daninda.farzana@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Kavindra Darka Buchori	Arka	Male	Active	kavindra.darka@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Aksella Mumtazzia	Ella	Female	Active	ella@millennia21.id	Grade 2	Grade 2 - Fireworks	2022/2023
Rama Raqqilla Iswara	Rama	Male	Active	rama.raqqilla@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Athmar Radja Daud Tobing	Radja	Male	Active	athmar.raja@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Dante Aldrich Marudo Siahaan	Dante	Male	Active	dante@millennia21.id	Grade 2	Grade 2 - Fireworks	2023/2024
Latiefa Aymar Azkia	Lala	Female	Active	latiefa.aymar@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Muhammad Joichiro Hara	Joe	Male	Active	muhammad.joichiro@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Arrafi Xavier Santoso	Arrafi	Male	Active	arrafi.xavier@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Saka Ephraim Nugroho	Saka	Male	Active	saka.ephraim@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Ni Putu Yura Prayasti Winata	Yura	Female	Active	ni.putu@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Svargabumi El-Arie Kusumo	L	Male	Active	bumi@millennia21.id	Grade 2	Grade 2 - Skyrocket	2022/2023
Anak Agung Gde Bagus Laksana Azzuri	Laksana	Male	Active	laks@millennia21.id	Grade 2	Grade 2 - Fireworks	2023/2024
Hagia Salford Atmodjo	Hagia	Male	Active	hagia.saford@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Irgi Yudhistira Arfan	Irgi	Male	Active	irgi@millennia21.id	Grade 2	Grade 2 - Skyrocket	2023/2024
Keenan Ilario Fahryan	Keenan	Male	Active	keenan@millennia21.id	Grade 2	Grade 2 - Fireworks	2022/2023
Arjuna Ghibran Barakatillah	Argi	Male	Active	arjuna@millennia21.id	Grade 2	Grade 2 - Fireworks	2022/2023
Ayska Raffasya Zen	Ayska	Female	Active	ayska.raffasya@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Irvine Airlangga Raharjo	Irvine	Male	Active	irvine@millennia21.id	Grade 2	Grade 2 - Skyrocket	2022/2023
Kareem Muhammad Noer	Kareem	Male	Active		Grade 2	Grade 2 - Skyrocket	2024/2025
Arjuno Rakha Bramastara	Juno	Male	Active	arjuno.rakha@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Garwita Hayu Kinara	Kinara	Female	Active	garwita.hayu@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Raisya Putri Nurdiana	Raisya	Female	Active	raisya.putri@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Adzra Arsyafiddien Amir	Adzra	Male	Active	adzra.arsyiafiddien@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Raqilla Kanaka Hadi Putra	Raqilla	Male	Active	raqilla.kanaka@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Gabe Raulito Butarbutar	Gabe	Male	Active	gabe.raulito@millennia21.id	Grade 2	Grade 2 - Fireworks	2024/2025
Arkanara Reska Wimbadi	Nara	Male	Active	arkanara.reska@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Nezard Gian Altair	Gian	Male	Active	nezard.gian@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Tuan Amarsha Veero	Amar	Male	Active	amarsha@millennia21.id	Grade 2	Grade 2 - Fireworks	2022/2023
Dastan Athallah Zein	Dastan	Male	Active	dastan@millennia21.id	Grade 2	Grade 2 - Fireworks	2023/2024
Narumi Cantika Niti Sukma	Nami	Female	Active	narumi.cantika@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Arsyakha Manendra Putra Alashri	Arsya	Male	Active	arsyakha.manendra@millennia21.id	Grade 2	Grade 2 - Skyrocket	2024/2025
Kania Andira Bintari	Kania	Female	Active	kania@millennia21.id	Grade 3	Grade 3 - Andromeda	2022/2023
Jermell Gadi Sumaputra	Jermell	Male	Active	jermell@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Mahika Girisa Arundati	Mahika	Female	Active	mahika@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Andara Janitra Harmoyo	Janitra	Female	Active	jani@millennia21.id	Grade 3	Grade 3 - Sombrero	2022/2023
Callula Nadya Kusuma	Callula	Female	Active	callula@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Aisyah Almahyra Muttaqien	Aisyah	Female	Active	aisyah.almahyra@millennia21.id	Grade 3	Grade 3 - Sombrero	2024/2025
Andrew Stewart Waterfall	Andrew	Male	Active	andrew.stewart@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Kalia Aubrey Shaqueena	Kalia	Female	Active	kalia@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Ragha Kariya Patria	Ragha	Male	Active	ragha@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Naraya Vidya Jabar	Vidya	Female	Active	naraya@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Arsyanendra Abid Prayitno	Abid	Male	Active	arsyanendra@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
M. Sakha Andaru	Sakha	Male	Active	muhammad.sakha@millennia21.id	Grade 3	Grade 3 - Sombrero	2024/2025
Dimas Shaluna Zoya Lenora	Shaluna	Female	Active	dimas@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Adriel Djulian Putra Aditya	Adriel	Male	Active	adriel@millennia21.id	Grade 3	Grade 3 - Sombrero	2020/2021
Khalifa Djawa Sawanara	Khalifa	Male	Active	khalifa@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Nararya Aliy Soesetyo	Aliy	Male	Active	alliy@millennia21.id	Grade 3	Grade 3 - Sombrero	2022/2023
Arsene Danendra Syafiq	Arsene	Male	Active	arsene@millennia21.id	Grade 3	Grade 3 - Andromeda	2021/2022
Nalar Nato Basira	Nato	Male	Active	nalar.nato@millennia21.id	Grade 3	Grade 3 - Sombrero	2024/2025
Kila Najma Aviano	Kila	Female	Active	kila@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Talia Khadijah	Talia	Female	Active	talia@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Rei Kalandra Siswanto	Rei	Female	Active	rei@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Ramadarlo Diaz Fathiranjana	Arlo	Male	Active	ramadarlo@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Ernest Kaisan Abhinaya	Ernest	Male	Active	ernest.kaisan@millennia21.id	Grade 3	Grade 3 - Sombrero	2025/2026
Frieska Weissa Cokro	Frieska	Female	Active	frieska@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Aisyah Puti Raufanza	Raufa	Female	Active	aisyah@millennia21.id	Grade 3	Grade 3 - Andromeda	2022/2023
Adrian Pradipta Arasya	Rasya	Male	Active	adrian@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
M. Affan Arkan Manaf	Affan	Male	Active	maffan@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Rashaka Thajera Noor	Rashaka	Male	Active	rashaka.thajera@millennia21.id	Grade 3	Grade 3 - Sombrero	2025/2026
Dafa Ihsan Adiputra	Dafa	Male	Active	dafa.ihsan@millennia21.id	Grade 3	Grade 3 - Andromeda	2024/2025
Rigo Giakarkahan	Rigo	Male	Active	rigo@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Emilio Aimar	Emilio	Male	Active	emilio@millennia21.id	Grade 3	Grade 3 - Andromeda	2022/2023
Eichiro D. Lucky Namberwan W 	Eiichiro	Male	Active	eichiro@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Zaydan Maqil Hezarfen	Zaydan	Male	Active	zaydan@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Timothy Sharga Manurung	Timothy	Male	Active	timothy@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Jaza Adjie Alkhairy	Kay	Male	Active	jaza@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Alradya Hafzah Adienda	Radya	Female	Active	radya@millennia21.id	Grade 3	Grade 3 - Sombrero	2022/2023
Anata Hideo Ridanto Prabowo	Hideo	Male	Active	anata@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Ilker Leventino Athariz Saladin	Ilker	Male	Active	ilker@millennia21.id	Grade 3	Grade 3 - Sombrero	2022/2023
Kenobi Lazuardi Mahiyasha	Kenobi	Male	Active	kenobi@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Bariq Temujin Andiputra	Ujin	Male	Active	"temujin@millennia21.id
"	Grade 3	Grade 3 - Andromeda	2023/2024
Aubrey Prianka Wide	Aubrey	Female	Active	aubrey@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Shaqueena Anindia Putri	Queeny	Female	Active	shaqueena@millennia21.id	Grade 3	Grade 3 - Sombrero	2021/2022
Alesha Kiara Wardana	Kiara	Female	Active	alesha.kiara@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Jihan Kirana Putri	Jihan	Female	Active	jihan@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Hilmarizky Jeremy Somadinata	Jemi	Male	Active	hilmarizky@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Kenzie Valerian Syarif	Kenzie	Male	Active	kenzie@millennia21.id	Grade 3	Grade 3 - Sombrero	2022/2023
Raesha Bianca Putri	Bianca	Female	Active	raesha@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Akasha Kieran Rania Iksata	Kieran	Female	Active	akasha.kieran@millennia21.id	Grade 3	Grade 3 - Sombrero	2024/2025
Panerang Giri Mustafa	Giri	Male	Active	panerang@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Raiddarka Muhammad Nugraha	Raiddarka	Male	Active	arka@millennia21.id	Grade 3	Grade 3 - Andromeda	2022/2023
Kimiko Ghania Sakhi	Kimi	Female	Active	kimiko@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Eleander Radeva Syahandi	Eleander	Male	Active	eleander@millennia21.id	Grade 3	Grade 3 - Sombrero	2022/2023
Rhaditya Gibran Putra Aryanto	Rhadit	Male	Active	Rhaditya@millennia21.id	Grade 3	Grade 3 - Sombrero	2022/2023
Althario Sakha Rajendra	Sakha	Male	Active	althario@millennia21.id	Grade 3	Grade 3 - Sombrero	2023/2024
Muhammad Arsakhi Zada Uwais	Zada	Male	Active	zada@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Kenjiro Arfa Nugraha	Kenjiro	Male	Active	kenjiro@millennia21.id	Grade 3	Grade 3 - Andromeda	2021/2022
Bravarrsa Dawanas	Arrsa	Male	Active	bravarrsa@millennia21.id	Grade 3	Grade 3 - Andromeda	2023/2024
Jemiel Kavi Avicenna Erhan	Jemie	Male	Active	jemie@millennia21.id	Grade 4	Grade 4 - Pinwheel	2024/2025
Kirana Zalika Kurniawan	Kirana	Female	Active	kirana.zalika@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2024/2025
Mareeam Mikaila Filantropi	Mika	Female	Active	mareeam@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Cheryl Alesha Kamala Permana	Cheryl	Female	Active	cheryl.alesha@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Ayrton Djuneidy Andyas Fattah	Ayrton	Male	Active	ayrton@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Adia Nismara Kanahaya	Adia	Female	Active	adia@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2021/2022
Afnan Fatharian Ibnu Dinandika	Afnan	Male	Active	afnan@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Milanne Adhista Madewi	Millie	Female	Active	millanne@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Shazfa Mahreen Khaliqa	Shazfa	Female	Active	shazfa@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Kiran Bhanurasmi Aryasena	Kiran	Female	Active	kiran@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Lalitha Nalladira Ginanjar	Nalla	Female	Active	lalitha.nalladira@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2024/2025
Elora Dara	Elora	Female	Active	elora@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Nailanda Pixa Arvania	Pixa	Female	Active	pixa@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Shilo Kalua Syafricilia	Shilo	Female	Active	shilo@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Akselle Mehrani	Elle	Female	Active	elle@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Kenzie Wastu Widyatara	Kenzie	Male	Active	kenzie.wastu@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Shakila Razeta Inara	Inara	Female	Active	shakila@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Waqas Ahmad	Waqas	Male	Active	waqas@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2024/2025
Egarra Nou Prastya	Egarra	Male	Active	egarra@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Altair Kurniawan	Altair	Male	Active	altair@millennia21.id	Grade 4	Grade 4 - Pinwheel	2021/2022
Elshaquilla Putrian	Elsha	Female	Active	elshaquilla.putrian@millennia21.id	Grade 4	Grade 4 - Pinwheel	2025/2026
Ammara Maryam Renata 	Ammara	Female	Active	ammara@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Neil Malik	Neil	Male	Active	neil@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2021/2022
Aksara Nata Nugraha	Aksara	Male	Active	aksara@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Magali Putri	Magali	Female	Active	magali.putri@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Razel Gabriel Calief	Razel	Male	Active	razel@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Raya Ananta Uli Nugroho	Raya	Male	Active	raya@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Ayudisa Baria Aditya	Disa	Female	Active	ayudisa@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Muhammad Kenzie Azka 	Azka	Male	Active	kenzie.azka@millennia21.id	Grade 4	Grade 4 - Pinwheel	2024/2025
Nerissa Celestyn Arkadewi	Nerissa	Female	Active	nerissa@millennia21.id	Grade 4	Grade 4 - Pinwheel	2021/2022
Raja Adil Ali Antoni	Adil	Male	Active	adil@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Miami Patrina Rakhmat	Miami	Female	Active	miami@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Trah Kandara Biru	Trah	Male	Active	trah@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Kaula Karamina Rahmi	Kaula	Female	Active	kaula@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Calysta Alesha Lubna	Calysta	Female	Active	calysta@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Ayra Mega Salsabila	Mega	Female	Active	mega@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Jeyshaan Singh Rahal	Jeyshaan	Male	Active	jeyshaan@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Mikaela Anjani Ganie	Mikaela	Female	Active	mikaela@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Algebra Altinouva Meliala	Algebra	Male	Active	algebra.altinouva@millennia21.id 	Grade 4	Grade 4 - Pinwheel	2024/2025
Aleesha Nahda Atmarini Dimpu	Aleesha	Female	Active	aleesha.nahda@millennia21.id	Grade 4	Grade 4 - Pinwheel	2024/2025
Gemilang Tawa Abinaya	Gemilang	Male	Active	gemilang@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Erland Moria Martin	Erland	Male	Active	erland.moria@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2025/2026
Frazushta Diyari Permana	Ata	Male	Active	frazushta@millennia21.id	Grade 4	Grade 4 - Pinwheel	2021/2022
Neo Omar	Neo	Male	Active	neo@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Taskya Alula	Alula	Female	Active	taskya@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Lirih Ombak	Ombak	Male	Active	ombak@millennia21.id	Grade 4	Grade 4 - Topsy Turvy	2022/2023
Alesa Wira Belltania	Alesa	Female	Active	alesa@millennia21.id	Grade 4	Grade 4 - Pinwheel	2022/2023
Kayla Dyandra Prasetyo	Mima	Female	Active	kayla.dyandra@millennia21.id	Grade 5	Grade 5 - Spindle	2024/2025
Zayn Hamid	Zayn	Male	Active	zayn.hamid@millennia21.id	Grade 5	Grade 5 - Spindle	2025/2026
Gael Mandala Subakti	Mandala	Male	Active	mandala@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Kanaya Anissa Sabhira	Kanaya	Female	Active	kanaya@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Hosea Metanoia Swarnagita Ginting	Noia	Male	Active	hosea.metanoia@millennia21.id	Grade 5	Grade 5 - Spindle	2025/2026
Augusto Batara Mahameru Keize	Bara	Male	Active	augusto@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Gennaia Annisa Kaisofie	Keke	Female	Active	keii@millennia21.id	Grade 5	Grade 5 - Spindle	2019/2020
Keenaradhitia Gendhis Puti Dahayu	Gendhis	Female	Active	keenaradhitia@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Hiromi Wada	Hiromi	Male	Active	hiromi.wada@millennia21.id	Grade 5	Grade 5 - Spindle	2025/2026
Jinggaraia Azzahra Perdana	Jingga	Female	Active	"jinggaraia@millennia21.id
"	Grade 5	Grade 5 - Spindle	2021/2022
Raiden Jibriel Dwisatria	Raiden	Male	Active	raiden@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Stellar Akia	Akia	Female	Active	stellar@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Terrence Gabriel Situmorang	Terry	Male	Active	terrence@millennia21.id	Grade 5	Grade 5 - Spindle	2019/2020
Ida Ayu Sinar Danya Rembulan	Sinar	Female	Active	ida@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Khayru Lazuardi Mahitala	Khayru	Male	Active	khyaru@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Jagad Aldrich Astrotamma	Jagad	Male	Active	jagad@millennia21.id	Grade 5	Grade 5 - Spindle	2019/2020
Aeronima Phoenix Hehuwat	Nixie	Male	Active	aeronima.phoenix@millennia21.id	Grade 5	Grade 5 - Spindle	2025/2026
Sofia Putri Karenia	Sofia	Female	Active	sofiakarenia@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Muhammad Ehnaf Askar	Askar	Male	Active	muhammad.ehnaf@millennia21.id	Grade 5	Grade 5 - Spindle	2024/2025
Himada El Kashva Nugraha	Kashva	Male	Active	kashva@millennia21.id	Grade 5	Grade 5 - Spindle	2021/2022
Agsya Ranya Charlenete	Ranya	Female	Active	agsya.ranya@millennia21.id	Grade 5	Grade 5 - Spindle	2025/2026
Dimas Pasa Pinggala	Dimas	Male	Active	dimas.pasa@millennia21.id	Grade 5	Grade 5 - Spindle	2024/2025
Kareem Abimana Nugraha	Kareem	Male	Active	kareem@millennia21.id	Grade 5	Grade 5 - Spindle	2019/2020
Jordy Ramadhan Abhipraya	Jordy	Male	Active	jordy@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Hamza Yusuf	Hamza	Male	Active	hamzah.yusuf@millennia21.id	Grade 6	Grade 6 - Perseus	2024/2025
Haura Atqiya	Rara	Female	Active	rara@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Kirei Annabel Fransisco	Kirei	Female	Active	kirei@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Keivaro Ferrer Prasetya	Ferrer	Male	Active	keivaro@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Abimanyu Pradja Soesetyo	Abi	Male	Active	abi@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Adanu Bagaspati Nugroho	Adanu	Male	Active	adanu@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Sherryn Weissa Cokro	Sherryn	Female	Active	sherryn@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Clio Tanaya Syafricilia	Clio	Female	Active	clio@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Ario Nararya Kusumo	Nara	Male	Active	ario@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Agha Pramudya Athmar	Agha	Male	Active	agha@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Gede Gian Maheshvara	Gian	Male	Active	gian@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Anak Agung Gde Bagus Lal Pranaya	Lal	Male	Active	lal@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Lautan Cahaya Timur	Laut	Male	Active	laut@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Keanu Adzani Rayyan	Keanu	Male	Active	keanu@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Chantal Eduward	Chantal	Female	Active	chantal@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Arthur Wisesa Raharjo	Arthur	Male	Active	arthur@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Tara Elena	Elena	Female	Active	tara@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Rafandra Mahira Wirawan	Hira	Male	Active	hira@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Liam Raza Ghanem	Liam	Male	Active	liam@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Alvaro Tristan Nugroho	Alvaro	Male	Active	alvaro@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Abia Kyra Naylandra	Abia	Female	Active	abia@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Kenzou Gibran Mahardika	Kenzou	Male	Active	kenzou@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Mikayla Bikrun Sakhi	Mika	Female	Active	mikayla@millennia21.id	Grade 6	Grade 6 - Perseus	2019/2020
Khalfani Wira Bellvania	Bellva	Female	Active	khalfani@millennia21.id	Grade 6	Grade 6 - Perseus	2020/2021
Sienna Ameerah Kasyafani	Sienna	Female	Active	sienna.kasyafani@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Alexa Fariistha Seftanto	Alexa	Female	Active	alexa.seftanto@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Prudence Aivan Anjali	Prudence	Female	Active	prudence@millennia21.id	Grade 7	Grade 7 - Helix	2019/2020
Prudence Aivan Anjali	Prudence	Female	Active	prudence@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Clara Shaqeenasheeva Kuntjoro	Sheeva	Female	Active	clara.kuntjoro@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Gvri’el Lahan Katresnan	Lahan	Female	Active	gvriel.katresnan@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Mikaila Zahra Nurmansyah	Mikaila	Female	Active	mikaila.nurmansyah@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Maliq Figlio Satar	Maliq	Male	Active	maliq@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Airin Putri Aprilia	Airin	Female	Active	airin.aprilia@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Ahmad Zayd Al Malik	Zayd	Male	Active	zayd@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Muhammad Dhia Murtaza Haryatmaja	Dhia	Male	Active	muhammadhia.haryatmaja@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Mika Arundhaya	Mika	Female	Active	mika.arundhaya@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Daanish Alexander Rasyefki	Daanish	Male	Active	daanish.rasyefki@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Naomi Quinn Kurniawan	Naomi	Female	Active	naomi.kurniawan@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Makaio Adhyastha Khalifi	Kio	Male	Active	makaio.khalifi@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Nayyara Sakya Meyla 	Nayya	Female	Active	nayyara.meyla@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Rayhany Alifya	Livy	Female	Active	rayhany.alifya@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Aqilla Shahila Puteri Baniadji	Aqilla	Female	Active	aqilla.baniandji@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Nadrina Cheryl Findriawan	Cheryl	Female	Active	nadrina.findriawan@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Bariq Bumi Braga Nararya	Braga	Male	Active	bariq.nararya@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Mikaila Rianna Panjaitan	Aila	Female	Active	mikaila.panjaitan@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Farieq Husein Shihab	Farieq	Male	Active	farieq@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Padma Arundhati Putri Sophiaan	Dhati	Female	Active	padma.sophiaan@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Maliq Ghadiel Darussalam Buwono	Maliq	Male	Active	maliq.buwono@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Ayumi Chesna Satria	Ayumi	Female	Active	ayumi.satria@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Denar Amali Priangga	Denar	Male	Active	denar.priangga@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Keandra Ksatria Budisanjaya	Keandra	Male	Active	keandra.budisanjaya@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Mosmeena Khadija Djajasuminta	Meena	Female	Active	mosmeena.mosmeena@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Anakin Tangguh Imana Kusumawardhana	Kinan	Male	Active	anakin.kusumawardhana@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Janitra Bestari Atmawati	Janitra	Female	Active	janitra@millennia21.id	Grade 7	Grade 7 - Helix	2019/2020
Derron Zakaria Mardhani	Derron	Male	Active	derron.mardhani@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Darrell Baihaqi Zulqornain	Darrell	Male	Active	darrell.zulqornain@millennia21.id	Grade 7	Grade 7 - Helix	2025/2026
Deandre Gili Riwara	Gili	Male	Active	deandre.gili@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Panji Bagus Bagastyo	Panji	Male	Active	panji.bagus@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Moussa Alvaro El Farabi	El	Male	Active	moussa.alvaro@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Pijar Cakrawala Multhazam	Pijar	Male	Active	pijar.cakrawala@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Keandra Nararya Wirayudha	Kean	Male	Active	keandra.nararya@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Agnes Wijaya Edbert	Agnes	Female	Active	agnes.wijaya@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Rayyan Fazal Wijaya	Rayyan	Male	Active	rayyan.fazzal@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Mochammad Barra Aymar	Barra	Male	Active	mochammad.barra@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Matthew Aryasatya Judha	Matthew	Male	Active	matthew.aryasatya@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Gabriella Eunike Sidabalok	Gabby	Female	Active	gabriella.eunike@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Suryafaza Subiandono	Faza	Male	Active	suryafaza.subiandono@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Nagalangit Timur	Naga	Male	Active	nagalangit.timur@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Bijak Maria Antoni	Bijak	Female	Active	bijak.maria@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Morris Akbar Sigra Wirasena	Morris	Male	Active	morris.akbar@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Alvaro Keenandra Wardana	Keenan	Male	Active	alvaro.keenandra@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Asha Zanett Somadinata	Zanett	Female	Active	asha.zanett@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Denyar Gemintang	Denyar	Female	Active	denyar.gemintang@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Aira Sophia Wibawa	Aira	Female	Active	aira.sophia@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Aika Santosa	Aika	Female	Active	aika.santosa@millennia21.id	Grade 8	Grade 8 - Cartwheel	2025/2026
Cheryl Adalicia Satria	Cheryl	Female	Active	cheryl.adalacia@millennia21.id	Grade 8	Grade 8 - Cartwheel	2025/2026
Art Abhirath	Art	Male	Active	art.abhirath@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Jagapati Ramadhan Abrar Birawidha	Abay	Male	Active	abay@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Syafadania Fitranto	Syafa	Female	Active	syafadania.fitranto@millennia21.id	Grade 8	Grade 8 - Cartwheel	2025/2026
Daffy Adzkar Zulqornain	Daffy	Male	Active	daffy.adzkar@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Darryl Orlando Maulana	Darryl	Male	Active	darryl.orlando@millennia21.id	Grade 8	Grade 8 - Cartwheel	2024/2025
Kefiro Ramadhika Historia	Kefiro	Male	Active	kefiro.historia@millennia21.id	Grade 8	Grade 8 - Cartwheel	2025/2026
Kaloka Prama Adanu	Kaloka	Male	Active	kaloka@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Aydira Malaika Ridwansyah	Aydira	Female	Active	aydira@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Mafaza Kanya Aisha	Kanya	Female	Active	mafaza@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Amar Muhammad Dezan	Amar	Male	Active	amar@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Gaea Alandra Ardhanny	Gaea	Female	Active	gaea.alandra@millennia21.id	Grade 9	Grade 9 - Messier 87	2024/2025
Eron Ricardo Rahman	Eron	Male	Active	eron@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Britania Kirana Sinulingga	Nia	Female	Active	britania@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Mikail Rasyefki	Mikail	Male	Active	michael@millennia21.id	Grade 9	Grade 9 - Messier 87	2024/2025
Cleo Madelaine Shenton	Cleo	Female	Active	cleo.madelaine@millennia21.id	Grade 9	Grade 9 - Messier 87	2024/2025
Prinz Averey Ikhsan	Verey	Male	Active	prinz@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Alethea Jeslyn Situmorang	Jeslyn	Female	Active	alethea@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Sara Savia Shihab	Sara	Female	Active	sara@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Aida Danesh Azka Hermawan	Danesh	Female	Active	aida.danesh@millennia21.id	Grade 9	Grade 9 - Messier 87	2024/2025
Naufal Permana Ilham	Naufal	Male	Active	naufal@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Nayla Rizqani Nafisha	Nayla	Female	Active	nayla@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Aralt Cendekia Wicaksono	Aralt	Male	Active	aralt.wicaksono@millennia21.id	Grade 9	Grade 9 - Messier 87	2024/2025
Putri Athena Mutiksari	Athena	Female	Active	athena@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Dindi Seraphina	Dindi	Female	Active	dindi@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Hana Arifatunnisa	Hana	Female	Active	hana.arifa@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Daffario Ali Falahrizwi	Rio	Male	Active	daffario@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Muhammad Rafif Cakradinata	Rafif	Male	Active	muhammad.rafif@millennia21.id	Grade 9	Grade 9 - Messier 87	2024/2025
Kenisha Azkayra Prabawa	Kayra	Female	Active	kenisha@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Nafisa Angelica Qurrota Aini	Aini	Female	Active	nafisa@millennia21.id	Grade 9	Grade 9 - Messier 87	2023/2024
Bhre Redana Kertabhumi	Bhumi	Male	Active	bhre.kertabhumi@millennia21.id	Kindergarten K1	Kindergarten - Milky Way	2025/2026
Arthur Léon Adam	Arthur	Male	Active	arthur.adam@millennia21.id	Kindergarten K1	Kindergarten - Starlight	2025/2026
Aleena Anaviya Alfaiz	Nena/Aleena	Female	Active	aleena.alfaiz@millennia21.id	Kindergarten K1	Kindergarten - Milky Way	2025/2026
Alisha Kalyani Rahelia	Sha	Female	Active	alisha.rahelia@millennia21.id	Kindergarten K1	Kindergarten - Bear Paw	2025/2026
Milikena Kalani Maryam	Mina	Female	Active	milikena.maryam@millennia21.id	Kindergarten K1	Kindergarten - Bear Paw	2025/2026
Assa Putra Wicaksono	Assa	Male	Active	assa.wicaksono@millennia21.id	Kindergarten K1	Kindergarten - Starlight	2025/2026
Elliana Uli Sitorus	Elliana	Female	Active	elliana.sitorus@millennia.21.id	Kindergarten K1	Kindergarten - Milky Way	2025/2026
Michaela Stacy Botshaft Lubis	Micha	Female	Active	michaela.lubis@millennia21.id	Kindergarten K1	Kindergarten - Starlight	2025/2026
Marco Tama Anderson Simanjuntak	Marco	Male	Active	marco.simanjuntak@millennia21.id	Kindergarten K1	Kindergarten - Milky Way	2025/2026
Chloe Adhel Tersya	Chloe	Female	Active	chloe.tersya@millennia21.id	Kindergarten K1	Kindergarten - Milky Way	2025/2026
Skylar Raelia Effans	Sky	Female	Active	skylar.effans@millennia21.id	Kindergarten K1	Kindergarten - Starlight	2025/2026
Nolan Ezekiel Wiratomo	Nolan	Male	Active	nolan.wiratomo@millennia21.id	Kindergarten K1	Kindergarten - Bear Paw	2025/2026
Zavier Akhtar Rayyan	Zavier	Male	Active	zavier.rayyan@millennia21.id	Kindergarten K1	Kindergarten - Bear Paw	2025/2026
Galan Ajda Fayyadh	Galan	Male	Active	galan.fayyadh@millennia21.id	Kindergarten K1	Kindergarten - Starlight	2025/2026
Indah Nyala Aruna	Nyala	Female	Active	indah.aruna@millennia21.id	Kindergarten K1	Kindergarten - Milky Way	2025/2026
Najma Haza Li Adami 	Najma	Female	Active	najma.adami@millennia21.id	Kindergarten K1	Kindergarten - Starlight	2025/2026
Luzio Satoru Hanan	Zio	Male	Active	luzio.hanan@millennia21.id	Kindergarten K1	Kindergarten - Milky Way	2025/2026
Isvara Kinandari 	Kinan	Female	Active	isvara.kinandari@millennia21.id	Kindergarten K1	Kindergarten - Bear Paw	2025/2026
Filippo Kennovara Subagyo	Kenno	Male	Active	filippo.subagyo@millennia21.id	Kindergarten K1	Kindergarten - Starlight	2025/2026
Halwatuzahra Queen Rahma Alesha	Alesha	Female	Active	hawaltuzahra.alesha@millennia21.id	Kindergarten K1	Kindergarten - Milky Way	2025/2026
Sharif Mohamed Ayad	Sharif	Male	Active	sharif.ayad@millennia21.id	Kindergarten K1	Kindergarten - Bear Paw	2025/2026
Belvrysa Dawanas	Icha	Female	Active	belvrysa.dawanas@millennia21.id	Kindergarten K1	Kindergarten - Starlight	2025/2026
Sofia Zelmira Satriani	Sofia	Female	Active	sofia.zelmira@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2024/2025
Serenata Svara Hati	Rena	Female	Active	serenata.hati@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2025/2026
Arthanami Diakonia Silalahi	Nami	Female	Active	arthanami@millennia21.id	Kindergarten K2	Kindergarten - Starlight	2023/2024
Misha Adhryana Azzahra	Misha	Female	Active	misha.adhryana@millennia21.id	Kindergarten K2	Kindergarten - Milky Way	2023/2024
Ashfiya Athalia Izzaty	Ashfiya	Female	Active	ashfiya.athalia@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2024/2025
Dominic Baskara Mandalawangi Keize	Ebeb	Male	Active	dominic.baskara@millennia21.id	Kindergarten K2	Kindergarten - Starlight	2024/2025
Keumala Giana Prameswari	Giana	Female	Active	keumala.giana@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2024/2025
Atharrazka Muhammad Adzafa	Razka	Male	Active	atharrazka.muhammad@millennia21.id	Kindergarten K2	Kindergarten - Starlight	2024/2025
Arellyn Raizelle Sibuea	Arellyn	Female	Active	arellyn.raizelle@millennia21.id	Kindergarten K2	Kindergarten - Milky Way	2024/2025
Louis Marvell Simadibrata	Louis	Male	Active	louis@millennia21.id	Kindergarten K2	Kindergarten - Milky Way	2023/2024
Mochammad Utsman Aymar	Utsman	Male	Active	mochammad.utsman@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2024/2025
Keola Zeeva Wardana	Keola	Female	Active	keola.zeeva@millennia21.id	Kindergarten K2	Kindergarten - Milky Way	2024/2025
Arin Haqqa Fiddini	Arin	Female	Active	arin@millennia21.id	Kindergarten K2	Kindergarten - Starlight	2023/2024
Aleysia Cyra Shakila	Cyra	Female	Active	aleysia.cyra@millennia21.id	Kindergarten K2	Kindergarten - Milky Way	2024/2025
Senara Hanna Iori	Senara	Female	Active		Kindergarten K2	Kindergarten - Starlight	2025/2026
Kelshanina Zeline Queenara Sulaiman	Zeline	Female	Active	k.sulaiman@millennia21.id	Kindergarten K2	Kindergarten - Milky Way	2025/2026
Keanussa Alnara Maulana	Kean	Male	Active	keanussa.alnara@millenia21.id	Kindergarten K2	Kindergarten - Starlight	2024/2025
Keenan Miles Situngkir	Keenan	Male	Active	keenan.miles@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2024/2025
Raffasha Aldricho Putra	Raffa	Male	Active	raffasha.aldrichoputra@millennia21.id	Kindergarten K2	Kindergarten - Starlight	2024/2025
Kahfi Alden Pranadipa	Kahfi	Male	Active	kahfi.alden@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2024/2025
Keegan Saverio Parviz	Keegan	Male	Active	keegan.parviz@millennia21.id	Kindergarten K2	Kindergarten - Starlight	2025/2026
Rofah	Rofah	Female	Active	rofah@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2023/2024
Talisha khairani	Talisha	Female	Active	talisha.khairani@millennia21.id	Kindergarten K2	Kindergarten - Starlight	2025/2026
Mikayla Alfath Bachrudin	Mikayla/Lala	Female	Active	mikayla.bachrudin@millennia21.id	Kindergarten K2	Kindergarten - Milky Way	2025/2026
Ileana Davka Rasendriya	Ileana	Female	Active	ileana.rasendriya@millennia21.id	Kindergarten K2	Kindergarten - Starlight	2025/2026
Ezra Arkara Timan	Ezra	Male	Active	ezra.arkara@millennia21.id	Kindergarten K2	Kindergarten - Bear Paw	2024/2025
Arman Pax Van Huis	Arman	Male	Active	arman.pax@millennia21.id	Kindergarten K2	Kindergarten - Milky Way	2024/2025
Nafesia Faizah Fihir	Nafe	Female	Active	nafesia.fihir@millennia21.id	Kindergarten Pre-K	Kindergarten - Milky Way	2025/2026
Muhammad Raffasya Adhryan Alfarizi	Raffa	Male	Active	muhammad.alfarizi@millennia21.id	Kindergarten Pre-K	Kindergarten - Bear Paw	2025/2026
Harsha Daniyal Hanendra	Harsha	Male	Active	harsha.hanendra@millennia21.id	Kindergarten Pre-K	Kindergarten - Bear Paw	2025/2026
Aisyah Shailene Hardian	Aisyah	Female	Active	aisyah.hardian@millennia21.id	Kindergarten Pre-K	Kindergarten - Milky Way	2025/2026
Gamila Rastika Shazani	Gami	Female	Active	gamila.shazani@millennia21.id	Kindergarten Pre-K	Kindergarten - Starlight	2025/2026
Zayden Kai Callisto	Zayden	Male	Active	zayden.callisto@millennia21.id	Kindergarten Pre-K	Kindergarten - Milky Way	2025/2026
Jahan Yuvraag	Jahan	Male	Active	jahan.yuvraag@millennia21.id	Kindergarten Pre-K	Kindergarten - Bear Paw	2025/2026
Tavisha Lee Moxie	Cici	Female	Active	tavisha.moxie@millennia21.id	Kindergarten Pre-K	Kindergarten - Starlight	2025/2026
Sanvi Gia Hosea	Gia 	Female	Active	sanvi.hosea@millennia21.id	Kindergarten Pre-K	Kindergarten - Bear Paw	2025/2026
`;

const sanitizeValue = (value = '') => value.replace(/^"|"$/g, '').trim();

const parseRow = (row) => {
    if (!row || !row.trim()) {
        return null;
    }

    const normalized = row.replace(/\r/g, '');
    let parts = normalized.split('\t');
    if (parts.length < 5) {
        parts = normalized.split(/\s{2,}/);
    }

    if (parts.length < 5) {
        return null;
    }

    const [name, nickname, gender, status, email, grade, className, joinYear] = parts.map(sanitizeValue);

    return {
        name,
        nickname: nickname || undefined,
        gender: gender ? gender.toLowerCase() : undefined,
        status: status ? status.toLowerCase() : undefined,
        email: email.toLowerCase() || undefined,
        currentGrade: grade || undefined,
        className: className || undefined,
        joinAcademicYear: joinYear || undefined
    };
};

const parseStudents = () => {
    const rows = RAW_DATA.trim().split(/\r?\n/);
    const [, ...dataRows] = rows;
    return dataRows
        .map(parseRow)
        .filter(Boolean);
};

const upsertStudent = async (student) => {
    const filter = student.email ? { email: student.email } : { name: student.name, joinAcademicYear: student.joinAcademicYear };
    const existing = await MTSSStudent.findOne(filter);

    if (existing) {
        await MTSSStudent.updateOne({ _id: existing._id }, student);
        return 'updated';
    }

    await MTSSStudent.create(student);
    return 'created';
};

const seed = async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI is required to seed MTSS students.');
        process.exit(1);
    }

    const students = parseStudents();
    if (!students.length) {
        console.error('No student rows detected in raw data.');
        process.exit(1);
    }

    try {
        await mongoose.connect(uri);
        console.log(`Connected to MongoDB. Upserting ${students.length} students...`);
        let created = 0;
        let updated = 0;

        for (const student of students) {
            const result = await upsertStudent(student);
            if (result === 'created') created += 1;
            else updated += 1;
        }

        console.log(`MTSS students seeding complete. Created: ${created}, Updated: ${updated}`);
    } catch (error) {
        console.error('Failed seeding MTSS students:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
};

seed();
