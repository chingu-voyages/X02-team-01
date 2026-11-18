"""Add two local-only demo certifications with three categories each (60 MC questions).

Run from backend/:
    python -m scripts.seed_demo_subjects --confirm-local

This adds new records alongside the existing learner-journey demo; it never
unpublishes, deletes or updates unrelated records. Do not seed real learner
responses: the learner submits their own answers via FastAPI. The private
answer keys remain in answer_options; explanations are released only through
normal per-question feedback.

Mathematics uses Unicode symbols (², √, π, ×, ≤) as ordinary text.
A full LaTeX typesetter would require separate frontend support.
Use only on a disposable LOCAL PostgreSQL database with demo data.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlmodel import Session

from app.db.session import engine
from app.models import (
    AnswerOption,
    Category,
    Certification,
    Question,
    QuestionVersion,
    User,
)
from scripts.seed_demo_exams import (
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
    ensure_row,
    require_safe_local_database,
)


@dataclass(frozen=True)
class DemoQuestion:
    prompt: str
    options: tuple[str, str, str, str]
    correct_positions: tuple[int, ...]
    explanation: str
    difficulty: str = "easy"


@dataclass(frozen=True)
class DemoCategory:
    slug: str
    name: str
    questions: tuple[DemoQuestion, ...]


@dataclass(frozen=True)
class DemoCertification:
    slug: str
    code: str
    name: str
    categories: tuple[DemoCategory, ...]


def subject_uuid(value: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"job-hackers/subjects-demo/v1/{value}")


PASSING_THRESHOLD = 70


def q(
    prompt: str,
    options: tuple[str, str, str, str],
    correct_positions: tuple[int, ...],
    explanation: str,
    difficulty: str = "easy",
) -> DemoQuestion:
    return DemoQuestion(prompt, options, correct_positions, explanation, difficulty)


CERTIFICATIONS = (
    DemoCertification(
        slug="quant",
        code="JHEP-DEMO-QUANT",
        name="Quantitative Reasoning — Demo",
        categories=(
            DemoCategory(
                slug="arithmetic",
                name="Arithmetic & Fractions",
                questions=(
                    q(
                        "What is 7 × 8?",
                        (
                            "54",
                            "56",
                            "64",
                            "58",
                        ),
                        (2,),
                        "Multiplication gives 7 × 8 = 56.",
                    ),
                    q(
                        "What is ¾ + ¼?",
                        (
                            "½",
                            "¾",
                            "1",
                            "1¼",
                        ),
                        (3,),
                        "Three quarters plus one quarter equals four quarters, or one.",
                    ),
                    q(
                        "Calculate 18 ÷ 3 + 2 using order of operations.",
                        (
                            "8",
                            "4",
                            "6",
                            "12",
                        ),
                        (1,),
                        "Divide first: 18 ÷ 3 = 6; then add 2 to get 8.",
                    ),
                    q(
                        "What is 15% of 200?",
                        (
                            "15",
                            "20",
                            "30",
                            "45",
                        ),
                        (3,),
                        "0.15 × 200 = 30.",
                    ),
                    q(
                        "Evaluate 2³.",
                        (
                            "6",
                            "8",
                            "9",
                            "12",
                        ),
                        (2,),
                        "2³ means 2 × 2 × 2 = 8.",
                    ),
                    q(
                        "What is √81?",
                        (
                            "8",
                            "7",
                            "10",
                            "9",
                        ),
                        (4,),
                        "The principal square root of 81 is 9 because 9² = 81.",
                    ),
                    q(
                        "Calculate −4 + 11.",
                        (
                            "7",
                            "−7",
                            "15",
                            "−15",
                        ),
                        (1,),
                        "Starting at −4 and adding 11 gives 7.",
                    ),
                    q(
                        "Simplify ⅚ − ⅓.",
                        (
                            "⅓",
                            "½",
                            "⅔",
                            "⅚",
                        ),
                        (2,),
                        "Convert ⅓ to sixths: ⅓ = 2/6. Then 5/6 − 2/6 = 3/6 = ½.",
                        difficulty="medium",
                    ),
                    q(
                        "Which fraction equals the decimal 0.75?",
                        (
                            "½",
                            "⅓",
                            "¼",
                            "¾",
                        ),
                        (4,),
                        "0.75 = 75/100 = 3/4 = ¾.",
                    ),
                    q(
                        "Which values are equivalent to ½? Select all that apply.",
                        (
                            "0.5",
                            "50%",
                            "2/4",
                            "0.25",
                        ),
                        (1, 2, 3),
                        "0.5, 50%, and 2/4 all represent one half; 0.25 represents one quarter.",
                        difficulty="medium",
                    ),
                ),
            ),
            DemoCategory(
                slug="algebra",
                name="Algebra & Equations",
                questions=(
                    q(
                        "Solve 2x + 3 = 13 for x.",
                        (
                            "4",
                            "5",
                            "6",
                            "8",
                        ),
                        (2,),
                        "Subtract 3 to get 2x = 10, then divide by 2: x = 5.",
                    ),
                    q(
                        "If x² = 25 and x ≥ 0, what is x?",
                        (
                            "−5",
                            "25",
                            "5",
                            "0",
                        ),
                        (3,),
                        "The nonnegative solution of x² = 25 is x = 5.",
                        difficulty="medium",
                    ),
                    q(
                        "Solve 3(x − 2) = 12.",
                        (
                            "6",
                            "4",
                            "8",
                            "10",
                        ),
                        (1,),
                        "Divide by 3 to get x − 2 = 4, so x = 6.",
                        difficulty="medium",
                    ),
                    q(
                        "If y = 2x + 1 and x = 4, what is y?",
                        (
                            "7",
                            "8",
                            "9",
                            "10",
                        ),
                        (3,),
                        "Substitute 4 for x: y = 2 × 4 + 1 = 9.",
                    ),
                    q(
                        "Simplify 4a + 3a.",
                        (
                            "12a",
                            "a",
                            "7",
                            "7a",
                        ),
                        (4,),
                        "Combine like terms: 4a + 3a = 7a.",
                    ),
                    q(
                        "Solve x/4 = 3 for x.",
                        (
                            "7",
                            "12",
                            "¾",
                            "1",
                        ),
                        (2,),
                        "Multiply both sides by 4 to get x = 12.",
                    ),
                    q(
                        "If x + 7 ≤ 12, which inequality is equivalent?",
                        (
                            "x ≤ 5",
                            "x ≥ 5",
                            "x < −5",
                            "x ≥ 19",
                        ),
                        (1,),
                        "Subtract 7 from both sides to get x ≤ 5.",
                        difficulty="medium",
                    ),
                    q(
                        "What is the slope of the line through (0, 2) and (2, 6)?",
                        (
                            "½",
                            "4",
                            "−2",
                            "2",
                        ),
                        (4,),
                        "Slope = (6 − 2)/(2 − 0) = 4/2 = 2.",
                        difficulty="medium",
                    ),
                    q(
                        "Solve 5x = 0.",
                        (
                            "5",
                            "0",
                            "−5",
                            "1",
                        ),
                        (2,),
                        "Dividing both sides by 5 gives x = 0.",
                    ),
                    q(
                        "Which values satisfy x² = 9? Select all that apply.",
                        (
                            "−3",
                            "3",
                            "0",
                            "9",
                        ),
                        (1, 2),
                        "Both −3 and 3 square to 9; 0 and 9 do not.",
                        difficulty="medium",
                    ),
                ),
            ),
            DemoCategory(
                slug="geometry",
                name="Geometry & Data",
                questions=(
                    q(
                        "What is the sum of the interior angles of a triangle?",
                        (
                            "180°",
                            "90°",
                            "270°",
                            "360°",
                        ),
                        (1,),
                        "The three interior angles of any Euclidean triangle add to 180°.",
                    ),
                    q(
                        "A rectangle is 6 cm long and 4 cm wide. What is its area?",
                        (
                            "10 cm²",
                            "20 cm²",
                            "24 cm²",
                            "48 cm²",
                        ),
                        (3,),
                        "Area = length × width = 6 × 4 = 24 cm².",
                    ),
                    q(
                        "What is the circumference of a circle with radius 3 cm?",
                        (
                            "3π cm",
                            "6π cm",
                            "9π cm",
                            "12π cm",
                        ),
                        (2,),
                        "Circumference is 2πr; with r = 3 cm it equals 6π cm.",
                        difficulty="medium",
                    ),
                    q(
                        "What is the mean of 2, 4, 6, and 8?",
                        (
                            "4",
                            "5",
                            "6",
                            "7",
                        ),
                        (2,),
                        "(2 + 4 + 6 + 8)/4 = 20/4 = 5.",
                    ),
                    q(
                        "What is the median of 1, 3, 7, 9, 11?",
                        (
                            "3",
                            "5",
                            "7",
                            "9",
                        ),
                        (3,),
                        "The middle value of the five ordered numbers is 7.",
                    ),
                    q(
                        "A fair coin is tossed once. What is P(heads)?",
                        (
                            "½",
                            "¼",
                            "¾",
                            "1",
                        ),
                        (1,),
                        "A fair coin has two equally likely outcomes; P(heads) = 1/2.",
                    ),
                    q(
                        "A right triangle has legs of 3 cm and 4 cm. What is the hypotenuse?",
                        (
                            "4 cm",
                            "6 cm",
                            "7 cm",
                            "5 cm",
                        ),
                        (4,),
                        "By Pythagoras, √(3² + 4²) = √25 = 5 cm.",
                        difficulty="medium",
                    ),
                    q(
                        "Convert 2.5 metres into centimetres.",
                        (
                            "25 cm",
                            "250 cm",
                            "2,500 cm",
                            "0.25 cm",
                        ),
                        (2,),
                        "1 metre = 100 centimetres; 2.5 × 100 = 250 cm.",
                    ),
                    q(
                        "An angle measuring exactly 90° is what kind of angle?",
                        (
                            "Acute",
                            "Obtuse",
                            "Right",
                            "Straight",
                        ),
                        (3,),
                        "An angle equal to 90° is a right angle.",
                    ),
                    q(
                        "For the values 10, 20, 30, which statements are true? Select all that apply.",
                        (
                            "Mean = 20",
                            "Median = 20",
                            "Range = 20",
                            "Mode = 20",
                        ),
                        (1, 2, 3),
                        "The mean and median are 20; the range is 30 − 10 = 20. There is no mode.",
                        difficulty="medium",
                    ),
                ),
            ),
        ),
    ),
    DemoCertification(
        slug="languages",
        code="JHEP-DEMO-LANG",
        name="Languages & Communication — Demo",
        categories=(
            DemoCategory(
                slug="spanish",
                name="Spanish Foundations",
                questions=(
                    q(
                        "What does the Spanish greeting «Hola» mean?",
                        (
                            "Hello",
                            "Goodbye",
                            "Please",
                            "Sorry",
                        ),
                        (1,),
                        "Hola is the common Spanish greeting for hello.",
                    ),
                    q(
                        "Translate «gracias» into English.",
                        (
                            "Good night",
                            "Thank you",
                            "Excuse me",
                            "Tomorrow",
                        ),
                        (2,),
                        "Gracias means thank you.",
                    ),
                    q(
                        "What does «¿Cómo estás?» ask?",
                        (
                            "Where are you?",
                            "What is your name?",
                            "How are you?",
                            "How old are you?",
                        ),
                        (3,),
                        "¿Cómo estás? is the informal way to ask how someone is doing.",
                    ),
                    q(
                        "Translate «Nos vemos mañana» into English.",
                        (
                            "We saw a morning",
                            "See you tomorrow",
                            "Good morning",
                            "We are studying",
                        ),
                        (2,),
                        "Nos vemos mañana means see you tomorrow; mañana can mean tomorrow in this context.",
                        difficulty="medium",
                    ),
                    q(
                        "What does «¿Dónde está la biblioteca?» mean?",
                        (
                            "How far is school?",
                            "What time is it?",
                            "Who is at home?",
                            "Where is the library?",
                        ),
                        (4,),
                        "¿Dónde? asks where, and biblioteca means library.",
                        difficulty="medium",
                    ),
                    q(
                        "Translate «el niño» into English.",
                        (
                            "The boy",
                            "The girl",
                            "The book",
                            "The teacher",
                        ),
                        (1,),
                        "El niño means the boy; the ñ is part of the spelling.",
                    ),
                    q(
                        "What is the usual meaning of «buenas noches»?",
                        (
                            "Good afternoon",
                            "Good morning",
                            "Good evening / good night",
                            "See you soon",
                        ),
                        (3,),
                        "Buenas noches can mean good evening or good night, depending on context.",
                    ),
                    q(
                        "Which Spanish word means water?",
                        (
                            "Casa",
                            "Agua",
                            "Libro",
                            "Amigo",
                        ),
                        (2,),
                        "Agua means water in Spanish.",
                    ),
                    q(
                        "Which sentence means “I have one book”?",
                        (
                            "Tengo un libro.",
                            "Soy un libro.",
                            "Está libro.",
                            "No tengo libros.",
                        ),
                        (1,),
                        "Tengo un libro means I have one book.",
                        difficulty="medium",
                    ),
                    q(
                        "Which Spanish expressions can be used as greetings? Select all that apply.",
                        (
                            "Buenos días",
                            "Buenas tardes",
                            "Hasta luego",
                            "Gracias",
                        ),
                        (1, 2),
                        "Buenos días and buenas tardes are greetings. Hasta luego is a farewell; gracias is thanks.",
                        difficulty="medium",
                    ),
                ),
            ),
            DemoCategory(
                slug="french",
                name="French Foundations",
                questions=(
                    q(
                        "What does «bonjour» usually mean?",
                        (
                            "Thank you",
                            "Hello / good day",
                            "Goodbye",
                            "Sorry",
                        ),
                        (2,),
                        "Bonjour is a common French greeting.",
                    ),
                    q(
                        "Translate «merci» into English.",
                        (
                            "Thank you",
                            "Tomorrow",
                            "Library",
                            "Friend",
                        ),
                        (1,),
                        "Merci means thank you.",
                    ),
                    q(
                        "What does «Où est la gare ?» mean?",
                        (
                            "Who is your teacher?",
                            "How old are you?",
                            "Where is the train station?",
                            "Where is the sea?",
                        ),
                        (3,),
                        "Où est means where is; la gare means the train station.",
                        difficulty="medium",
                    ),
                    q(
                        "Translate «Je m’appelle Léa.»",
                        (
                            "I know Léa.",
                            "I am with Léa.",
                            "I like Léa.",
                            "My name is Léa.",
                        ),
                        (4,),
                        "Je m’appelle is used to introduce one's name.",
                        difficulty="medium",
                    ),
                    q(
                        "Which French word means school?",
                        (
                            "École",
                            "Étoile",
                            "Église",
                            "Écran",
                        ),
                        (1,),
                        "École means school. Étoile means star; église means church; écran means screen.",
                    ),
                    q(
                        "What does «À bientôt !» mean?",
                        (
                            "Good night",
                            "See you soon",
                            "Thank you",
                            "Welcome",
                        ),
                        (2,),
                        "À bientôt is used to say see you soon.",
                    ),
                    q(
                        "Translate «J’ai trois pommes.»",
                        (
                            "I ate three pears.",
                            "I see an apple.",
                            "I have three apples.",
                            "I want three apples.",
                        ),
                        (3,),
                        "J’ai means I have, trois means three, and pommes means apples.",
                        difficulty="medium",
                    ),
                    q(
                        "What does «Il fait froid.» communicate about the weather?",
                        (
                            "It is hot",
                            "It is raining",
                            "It is sunny",
                            "It is cold",
                        ),
                        (4,),
                        "Il fait froid is a common way to say the weather is cold.",
                    ),
                    q(
                        "Which expression means please in polite French?",
                        (
                            "S’il vous plaît",
                            "Merci beaucoup",
                            "Au revoir",
                            "De rien",
                        ),
                        (1,),
                        "S’il vous plaît means please, using the polite or plural form of address.",
                    ),
                    q(
                        "Which of these are French articles? Select all that apply.",
                        (
                            "le",
                            "la",
                            "un",
                            "y",
                        ),
                        (1, 2, 3),
                        "Le and la are definite articles; un is an indefinite article. Y is not an article.",
                        difficulty="medium",
                    ),
                ),
            ),
            DemoCategory(
                slug="world",
                name="World Languages",
                questions=(
                    q(
                        "What does Japanese «こんにちは» (konnichiwa) mean?",
                        (
                            "Sorry",
                            "Hello / good afternoon",
                            "Goodbye",
                            "Thank you",
                        ),
                        (2,),
                        "こんにちは is a Japanese greeting commonly used during the day.",
                    ),
                    q(
                        "Translate Japanese «ありがとう» (arigatō).",
                        (
                            "Please",
                            "Welcome",
                            "Goodbye",
                            "Thank you",
                        ),
                        (4,),
                        "ありがとう means thank you.",
                    ),
                    q(
                        "What is a common meaning of Arabic «مرحبا» (marḥaban)?",
                        (
                            "Hello",
                            "Good night",
                            "Water",
                            "Book",
                        ),
                        (1,),
                        "مرحبا is a common Arabic greeting meaning hello.",
                    ),
                    q(
                        "Translate German «Guten Morgen».",
                        (
                            "Good evening",
                            "Goodbye",
                            "Good morning",
                            "Good afternoon",
                        ),
                        (3,),
                        "Guten Morgen means good morning.",
                    ),
                    q(
                        "What does Mandarin Chinese «谢谢» (xièxie) mean?",
                        (
                            "Hello",
                            "Thank you",
                            "Tomorrow",
                            "Please",
                        ),
                        (2,),
                        "谢谢 is used to thank someone in Mandarin Chinese.",
                    ),
                    q(
                        "What is the usual meaning of Korean «안녕하세요» (annyeonghaseyo)?",
                        (
                            "A polite hello",
                            "Goodbye forever",
                            "Please eat",
                            "My name is",
                        ),
                        (1,),
                        "안녕하세요 is a polite Korean greeting.",
                    ),
                    q(
                        "Translate Portuguese «Bom dia».",
                        (
                            "Good night",
                            "Welcome",
                            "Goodbye",
                            "Good morning",
                        ),
                        (4,),
                        "Bom dia means good morning or good day in Portuguese.",
                    ),
                    q(
                        "Hindi «नमस्ते» (namaste) is commonly used as what?",
                        (
                            "A number",
                            "A farewell only",
                            "A greeting",
                            "A question about time",
                        ),
                        (3,),
                        "नमस्ते is widely used as a greeting in Hindi.",
                    ),
                    q(
                        "What does Russian «спасибо» (spasibo) mean?",
                        (
                            "Yesterday",
                            "Thank you",
                            "School",
                            "Hello",
                        ),
                        (2,),
                        "Спасибо means thank you in Russian.",
                    ),
                    q(
                        "Which translation pairs are correct? Select all that apply.",
                        (
                            "ありがとう → thank you",
                            "merci → thank you",
                            "gracias → thank you",
                            "danke → goodbye",
                        ),
                        (1, 2, 3),
                        "Japanese ありがとう, French merci, and Spanish gracias express thanks. German danke also means thanks, not goodbye.",
                        difficulty="medium",
                    ),
                ),
            ),
        ),
    ),
)


def validate_bank() -> None:
    """Validate dataset before opening a transaction."""
    if len(CERTIFICATIONS) != 2:
        raise ValueError("Exactly two additional certifications are required")
    if len({cert.slug for cert in CERTIFICATIONS}) != 2:
        raise ValueError("Certification slugs must be distinct")
    if len({cert.code for cert in CERTIFICATIONS}) != 2:
        raise ValueError("Certification codes must be distinct")
    for cert in CERTIFICATIONS:
        if not cert.name.strip() or not cert.code.strip():
            raise ValueError("Certification name and code must be nonempty")
        if len(cert.categories) != 3:
            raise ValueError(f"{cert.name} must have exactly three categories")
        if len({category.slug for category in cert.categories}) != 3:
            raise ValueError(f"Duplicate category slugs in {cert.name}")
        if len({category.name for category in cert.categories}) != 3:
            raise ValueError(f"Duplicate category names in {cert.name}")
        for category in cert.categories:
            if len(category.questions) != 10:
                raise ValueError(f"{category.name} must have exactly 10 questions")
            if not category.name.strip():
                raise ValueError("Category name cannot be blank")
            if len({question.prompt for question in category.questions}) != 10:
                raise ValueError(f"Duplicate questions in {category.name}")
            for question in category.questions:
                if (
                    not question.prompt.strip()
                    or not question.explanation.strip()
                    or question.difficulty not in {"easy", "medium", "hard"}
                    or len(question.options) != 4
                    or any(not option.strip() for option in question.options)
                    or not question.correct_positions
                    or len(set(question.correct_positions))
                    != len(question.correct_positions)
                    or any(
                        position not in {1, 2, 3, 4}
                        for position in question.correct_positions
                    )
                ):
                    raise ValueError(f"Invalid question: {question.prompt}")


def seed() -> dict[str, int]:
    """Insert new deterministic demo records without editing unrelated rows."""
    require_safe_local_database()
    validate_bank()
    counts = {
        "users": 0,
        "certifications": 0,
        "categories": 0,
        "questions": 0,
        "question_versions": 0,
        "answer_options": 0,
    }

    with Session(engine) as session, session.begin():
        counts["users"] += ensure_row(
            session, User(id=DEMO_USER_ID, email=DEMO_USER_EMAIL), ("email",)
        )
        for cert in CERTIFICATIONS:
            cert_key = f"{cert.slug}/certification"
            cert_id = subject_uuid(cert_key)
            counts["certifications"] += ensure_row(
                session,
                Certification(
                    id=cert_id,
                    code=cert.code,
                    name=cert.name,
                    passing_threshold_pct=PASSING_THRESHOLD,
                    feedback_mode="immediate",
                ),
                ("code", "name", "passing_threshold_pct", "feedback_mode"),
            )
            for category in cert.categories:
                category_key = f"{cert.slug}/{category.slug}"
                category_id = subject_uuid(f"{category_key}/category")
                counts["categories"] += ensure_row(
                    session,
                    Category(
                        id=category_id,
                        certification_id=cert_id,
                        name=category.name,
                        is_published=True,
                    ),
                    ("certification_id", "name", "is_published"),
                )
                for number, item in enumerate(category.questions, start=1):
                    question_id = subject_uuid(f"{category_key}/question/{number}")
                    version_id = subject_uuid(f"{category_key}/version/{number}")
                    counts["questions"] += ensure_row(
                        session,
                        Question(
                            id=question_id,
                            certification_id=cert_id,
                            category_id=category_id,
                            difficulty=item.difficulty,
                            created_by_id=DEMO_USER_ID,
                        ),
                        (
                            "certification_id",
                            "category_id",
                            "difficulty",
                            "created_by_id",
                        ),
                    )
                    counts["question_versions"] += ensure_row(
                        session,
                        QuestionVersion(
                            id=version_id,
                            question_id=question_id,
                            version_number=1,
                            question_text=item.prompt,
                            question_type="multiple_choice",
                            allows_multiple_answers=len(item.correct_positions) > 1,
                            explanation=item.explanation,
                            review_status="approved",
                            publication_status="active",
                            is_flagged=False,
                            submitted_by_id=DEMO_USER_ID,
                            reviewed_by_id=DEMO_USER_ID,
                            reviewed_at=datetime.now(UTC),
                        ),
                        (
                            "question_id",
                            "version_number",
                            "question_text",
                            "question_type",
                            "allows_multiple_answers",
                            "explanation",
                            "review_status",
                            "publication_status",
                            "is_flagged",
                        ),
                    )
                    for position, text in enumerate(item.options, start=1):
                        counts["answer_options"] += ensure_row(
                            session,
                            AnswerOption(
                                id=subject_uuid(
                                    f"{category_key}/option/{number}/{position}"
                                ),
                                question_version_id=version_id,
                                position=position,
                                option_text=text,
                                is_correct=position in item.correct_positions,
                            ),
                            (
                                "question_version_id",
                                "position",
                                "option_text",
                                "is_correct",
                            ),
                        )
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-local",
        action="store_true",
        help="Required acknowledgment for a disposable local development database",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate the question bank without writing any database records",
    )
    args = parser.parse_args()
    if args.validate_only:
        validate_bank()
        print("Bank valid: 2 certifications, 6 categories, 60 questions")
        return
    if not args.confirm_local:
        parser.error(
            "Only disposable local databases are allowed; pass --confirm-local"
        )
    counts = seed()
    print("Additional subjects seeded (new rows; reruns report zero):")
    for model, count in counts.items():
        print(f"  {model}: {count}")
    for cert in CERTIFICATIONS:
        print(f"{cert.name}: 3 categories, 30 questions")
        for category in cert.categories:
            print(f"  - {category.name}: {len(category.questions)} questions")
    print("No learner answers were created. Existing categories remain unchanged.")


if __name__ == "__main__":
    main()
