package p

enum Mood {
    HAPPY, GLOOMY

    Mood flip() { this == HAPPY ? GLOOMY : HAPPY }
}
